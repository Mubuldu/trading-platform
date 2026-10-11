import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { StreamConsumerService } from '@infrastructure/redis/streams/stream-consumer.service';
import { StreamPublisherService } from '@infrastructure/redis/streams/stream-publisher.service';
import { ConsumerManagerService } from '@infrastructure/redis/streams/consumer-manager.service';
import { STREAM_NAMES } from '@infrastructure/redis/streams/stream-names.constants';
import { ConsumedMessage } from '@infrastructure/redis/streams/stream-event.interface';
import { IPositionRepository } from '@infrastructure/database/repository/position.repository';
import { DATABASE_TOKENS } from '@infrastructure/database/database.tokens';
import { PositionConfig } from '@config/position.config';
import { OrderSide } from '@modules/exchange/enums/order.enums';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { ExecutionReportModel } from '@modules/execution/domain/models/execution-report.model';
import { ExecutionStatus } from '@modules/execution/domain/enums/execution-status.enum';
import { PositionModel, createFlatPosition } from '../../domain/models/position.model';
import { FillEventModel } from '../../domain/models/fill-event.model';
import { PortfolioSummaryModel } from '../../domain/models/portfolio-summary.model';
import { PositionState } from '../../domain/enums/position-state.enum';
import { PositionDirection } from '../../domain/enums/position-direction.enum';
import { PositionValidatorService } from './position-validator.service';
import { PnlCalculatorService } from './pnl-calculator.service';
import { PositionStateMachineService } from './position-state-machine.service';
import { PositionCacheService } from './position-cache.service';

@Injectable()
export class PositionManagerService implements OnModuleInit {
  private readonly context = PositionManagerService.name;
  private readonly cfg: PositionConfig;

  constructor(
    configService: ConfigService,
    private readonly logger: AppLoggerService,
    private readonly consumer: StreamConsumerService,
    private readonly consumerManager: ConsumerManagerService,
    private readonly publisher: StreamPublisherService,
    @Inject(DATABASE_TOKENS.POSITION_REPOSITORY)
    private readonly positionRepo: IPositionRepository,
    private readonly validator: PositionValidatorService,
    private readonly pnlCalc: PnlCalculatorService,
    private readonly stateMachine: PositionStateMachineService,
    private readonly cache: PositionCacheService,
  ) {
    this.cfg = configService.get<PositionConfig>('position')!;
  }

  async onModuleInit(): Promise<void> {
    if (!this.cfg.enabled) {
      this.logger.warn('Position Manager is DISABLED — fills will not be tracked', this.context);
      return;
    }

    await this.consumerManager.registerGroup({
      streamName: STREAM_NAMES.EXECUTION_REPORT,
      groupName: this.cfg.consumerGroup,
      startId: '0',
    });

    this.consumer.subscribe(STREAM_NAMES.EXECUTION_REPORT, this.cfg.consumerGroup, (msg) =>
      this.handleExecutionReport(msg),
    );

    this.logger.log(
      `Position Manager initialized — consuming ${STREAM_NAMES.EXECUTION_REPORT} as group "${this.cfg.consumerGroup}"`,
      this.context,
    );
  }

  private async handleExecutionReport(msg: ConsumedMessage): Promise<void> {
    const report = msg.event.payload as unknown as ExecutionReportModel;

    // Paper trading fills carry exchangeId=PAPER_TRADING and are handled
    // exclusively by PaperPositionManagerService. Skip them here to ensure
    // live and paper portfolios remain fully isolated.
    if ((report.exchangeId as unknown as string) === ExchangeId.PAPER_TRADING) return;

    if (!this.isProcessable(report)) return;

    const fill: FillEventModel = {
      fillId: report.reportId,
      requestId: report.requestId,
      exchangeId: report.exchangeId,
      symbol: report.symbol,
      side: report.side as OrderSide,
      executedQuantity: report.executedQuantity,
      remainingQuantity: report.remainingQuantity,
      averagePrice: report.averagePrice,
      reportType: report.reportType,
      status: report.status,
      strategyId: report.strategyId,
      generatedAt: report.generatedAt,
    };

    await this.processFill(fill);
  }

  async processFill(fill: FillEventModel): Promise<void> {
    const position = await this.loadOrCreate(fill);

    const validationResult = this.validator.validate(fill, position);
    if (validationResult.isErr()) {
      this.logger.warn(
        `Fill rejected: ${validationResult.error.message} (fillId=${fill.fillId})`,
        this.context,
      );
      return;
    }

    if (!this.validator.isActionable(fill)) {
      this.logger.debug(
        `Skipping non-actionable fill: type=${fill.reportType} qty=${fill.executedQuantity}`,
        this.context,
      );
      return;
    }

    const transitionResult = this.stateMachine.apply(position, fill);
    if (transitionResult.isErr()) {
      this.logger.error(
        `State machine error: ${transitionResult.error.message} (fillId=${fill.fillId})`,
        undefined,
        this.context,
      );
      return;
    }

    const transition = transitionResult.value;

    const pnlSnapshot = this.pnlCalc.buildSnapshot(
      position.realizedPnl,
      this.pnlCalc.calculateUnrealizedPnl(
        position.direction,
        position.quantity,
        position.averageEntryPrice,
        fill.averagePrice,
      ),
      position.totalFees,
    );

    position.unrealizedPnl = pnlSnapshot.unrealizedPnl;
    position.grossPnl = pnlSnapshot.grossPnl;
    position.netPnl = pnlSnapshot.netPnl;
    position.feeAdjustedPnl = pnlSnapshot.feeAdjustedPnl;

    await this.persist(position);
    await this.publishPositionUpdate(position, fill);

    const allPositions = await this.cache.loadAll();
    await this.publishPortfolioUpdate(allPositions, fill);
    await this.publishRiskUpdate(allPositions, fill);

    this.logger.log(
      `[${transition.action}] ${fill.side} ${fill.executedQuantity} ${fill.symbol}@${fill.averagePrice} ` +
        `| state=${position.state} dir=${position.direction} qty=${position.quantity} ` +
        `| realPnl=${position.realizedPnl.toFixed(4)} unrealPnl=${position.unrealizedPnl.toFixed(4)}`,
      this.context,
    );
  }

  getOpenPositions(): Promise<PositionModel[]> {
    return this.cache.loadAll().then((all) => all.filter((p) => p.state !== PositionState.FLAT));
  }

  buildPortfolioSummary(positions: PositionModel[]): PortfolioSummaryModel {
    const open = positions.filter((p) => p.state !== PositionState.FLAT);
    let totalExposure = 0;
    let totalUnrealizedPnl = 0;
    let totalRealizedPnl = 0;
    let totalFees = 0;
    let winning = 0;
    let losing = 0;
    let breakEven = 0;

    for (const p of open) {
      totalExposure += p.quantity * p.averageEntryPrice;
      totalUnrealizedPnl += p.unrealizedPnl;
      totalRealizedPnl += p.realizedPnl;
      totalFees += p.totalFees;

      if (p.unrealizedPnl > 0) winning++;
      else if (p.unrealizedPnl < 0) losing++;
      else breakEven++;
    }

    const grossPnl = totalRealizedPnl + totalUnrealizedPnl;
    return {
      totalOpenPositions: open.length,
      winningPositions: winning,
      losingPositions: losing,
      breakEvenPositions: breakEven,
      totalExposure,
      totalUnrealizedPnl,
      totalRealizedPnl,
      totalFees,
      netPnl: grossPnl,
      feeAdjustedPnl: grossPnl - totalFees,
      snapshotAt: Date.now(),
    };
  }

  private async loadOrCreate(fill: FillEventModel): Promise<PositionModel> {
    const cached = await this.cache.load(fill.exchangeId, fill.symbol);
    if (cached) return cached;

    const dbResult = await this.positionRepo.findByAccountAndSymbol(
      this.cfg.defaultAccountId,
      fill.symbol,
    );

    if (dbResult.isOk() && dbResult.value.length > 0) {
      const row = dbResult.value[0];
      if (row.status === 'open') {
        const restored = this.fromDbRow(row);
        await this.cache.save(restored);
        return restored;
      }
    }

    return createFlatPosition(
      fill.exchangeId,
      this.cfg.defaultAccountId,
      fill.symbol,
      fill.strategyId,
    );
  }

  private async persist(position: PositionModel): Promise<void> {
    await this.cache.save(position);

    try {
      if (position.version === 1) {
        await this.positionRepo.save({
          account_id: position.accountId,
          exchange_id: position.exchangeId,
          symbol: position.symbol,
          position_side: position.direction,
          margin_mode: 'cross',
          leverage: 1,
          entry_price: String(position.entryPrice),
          mark_price: String(position.averageEntryPrice),
          quantity: String(position.quantity),
          notional_value: String(position.quantity * position.averageEntryPrice),
          unrealized_pnl: String(position.unrealizedPnl),
          realized_pnl: String(position.realizedPnl),
          liquidation_price: null,
          margin_used: '0',
          maintenance_margin: '0',
          position_value: String(position.quantity * position.averageEntryPrice),
          is_auto_add_margin: false,
          status: position.state === PositionState.FLAT ? 'closed' : 'open',
        });
      } else {
        const dbResult = await this.positionRepo.findByAccountAndSymbol(
          position.accountId,
          position.symbol,
        );

        if (dbResult.isOk() && dbResult.value.length > 0) {
          const row = dbResult.value[0];
          await this.positionRepo.updateOptimistic(row.id, row.version, {
            quantity: String(position.quantity),
            entry_price: String(position.entryPrice),
            mark_price: String(position.averageEntryPrice),
            notional_value: String(position.quantity * position.averageEntryPrice),
            unrealized_pnl: String(position.unrealizedPnl),
            realized_pnl: String(position.realizedPnl),
            position_value: String(position.quantity * position.averageEntryPrice),
            position_side: position.direction,
            status: position.state === PositionState.FLAT ? 'closed' : 'open',
            updated_at: new Date(position.updatedAt),
          });
        }
      }
    } catch (e) {
      this.logger.error(
        `DB persist failed for ${position.symbol}: ${(e as Error).message}`,
        undefined,
        this.context,
      );
    }
  }

  private async publishPositionUpdate(
    position: PositionModel,
    fill: FillEventModel,
  ): Promise<void> {
    try {
      await this.publisher.publish(STREAM_NAMES.POSITION_UPDATE, {
        correlationId: fill.requestId,
        eventType: 'PositionUpdate',
        exchange: position.exchangeId,
        symbol: position.symbol,
        timestamp: position.updatedAt,
        producer: this.context,
        payload: {
          positionId: position.positionId,
          exchangeId: position.exchangeId,
          symbol: position.symbol,
          direction: position.direction,
          state: position.state,
          quantity: position.quantity,
          averageEntryPrice: position.averageEntryPrice,
          unrealizedPnl: position.unrealizedPnl,
          realizedPnl: position.realizedPnl,
          grossPnl: position.grossPnl,
          netPnl: position.netPnl,
          feeAdjustedPnl: position.feeAdjustedPnl,
          totalFees: position.totalFees,
          openedAt: position.openedAt,
          updatedAt: position.updatedAt,
        },
      });
    } catch (e) {
      this.logger.error(
        `Failed to publish position update: ${(e as Error).message}`,
        undefined,
        this.context,
      );
    }
  }

  private async publishPortfolioUpdate(
    positions: PositionModel[],
    fill: FillEventModel,
  ): Promise<void> {
    try {
      const summary = this.buildPortfolioSummary(positions);
      await this.publisher.publish(STREAM_NAMES.PORTFOLIO_UPDATE, {
        correlationId: fill.requestId,
        eventType: 'PortfolioUpdate',
        exchange: fill.exchangeId,
        symbol: fill.symbol,
        timestamp: summary.snapshotAt,
        producer: this.context,
        payload: summary as unknown as Record<string, unknown>,
      });
    } catch (e) {
      this.logger.error(
        `Failed to publish portfolio update: ${(e as Error).message}`,
        undefined,
        this.context,
      );
    }
  }

  private async publishRiskUpdate(positions: PositionModel[], fill: FillEventModel): Promise<void> {
    try {
      const open = positions.filter((p) => p.state !== PositionState.FLAT);
      const totalExposure = open.reduce((sum, p) => sum + p.quantity * p.averageEntryPrice, 0);
      const totalUnrealizedPnl = open.reduce((sum, p) => sum + p.unrealizedPnl, 0);

      await this.publisher.publish(STREAM_NAMES.RISK_UPDATE, {
        correlationId: fill.requestId,
        eventType: 'RiskUpdate',
        exchange: fill.exchangeId,
        symbol: fill.symbol,
        timestamp: Date.now(),
        producer: this.context,
        payload: {
          openPositions: open.map((p) => ({
            positionId: p.positionId,
            symbol: p.symbol,
            direction: p.direction,
            quantity: p.quantity,
            averageEntryPrice: p.averageEntryPrice,
            unrealizedPnl: p.unrealizedPnl,
            exposure: p.quantity * p.averageEntryPrice,
          })),
          totalExposure,
          totalUnrealizedPnl,
          openPositionCount: open.length,
        },
      });
    } catch (e) {
      this.logger.error(
        `Failed to publish risk update: ${(e as Error).message}`,
        undefined,
        this.context,
      );
    }
  }

  private isProcessable(report: ExecutionReportModel): boolean {
    return (
      report.executedQuantity > 0 &&
      report.status !== ExecutionStatus.FAILED &&
      report.status !== ExecutionStatus.CANCELLED &&
      report.status !== ExecutionStatus.REJECTED &&
      report.status !== ExecutionStatus.PENDING &&
      report.status !== ExecutionStatus.SUBMITTED
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private fromDbRow(row: any): PositionModel {
    const direction = row.position_side as PositionDirection;
    return {
      positionId: `${row.exchange_id}:${row.symbol}`,
      exchangeId: row.exchange_id,
      accountId: row.account_id,
      symbol: row.symbol,
      strategyId: 'restored',
      direction,
      state: row.status === 'closed' ? PositionState.FLAT : PositionState.OPEN,
      quantity: parseFloat(row.quantity),
      entryPrice: parseFloat(row.entry_price),
      averageEntryPrice: parseFloat(row.mark_price ?? row.entry_price),
      realizedPnl: parseFloat(row.realized_pnl),
      unrealizedPnl: parseFloat(row.unrealized_pnl),
      grossPnl: parseFloat(row.unrealized_pnl) + parseFloat(row.realized_pnl),
      netPnl: parseFloat(row.unrealized_pnl) + parseFloat(row.realized_pnl),
      feeAdjustedPnl: parseFloat(row.unrealized_pnl) + parseFloat(row.realized_pnl),
      totalFees: 0,
      totalFunding: 0,
      totalSlippage: 0,
      openedAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
      closedAt: row.status === 'closed' ? new Date(row.updated_at).getTime() : null,
      version: row.version,
      fillIds: [],
      fills: [],
    };
  }
}
