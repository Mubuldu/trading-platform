import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { StreamConsumerService } from '@infrastructure/redis/streams/stream-consumer.service';
import { StreamPublisherService } from '@infrastructure/redis/streams/stream-publisher.service';
import { ConsumerManagerService } from '@infrastructure/redis/streams/consumer-manager.service';
import { STREAM_NAMES, StreamName } from '@infrastructure/redis/streams/stream-names.constants';
import { ConsumedMessage } from '@infrastructure/redis/streams/stream-event.interface';
import { PaperTradingConfig } from '@config/paper-trading.config';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { OrderSide } from '@modules/exchange/enums/order.enums';
import { ExecutionReportModel } from '@modules/execution/domain/models/execution-report.model';
import { ExecutionStatus } from '@modules/execution/domain/enums/execution-status.enum';
import { RiskEngineService } from '@modules/risk/application/services/risk-engine.service';
import { AlertEngineService } from '@modules/alerts/application/services/alert-engine.service';
import { AlertLevel } from '@modules/alerts/domain/alert-level.enum';
import { AlertCategory } from '@modules/alerts/domain/alert-category.enum';
import { AlertCondition } from '@modules/alerts/domain/alert-condition.enum';
import { PaperPositionState } from '../../domain/models/paper-account-state.model';
import { PaperStateStoreService } from '../../infrastructure/store/paper-state-store.service';
import { PaperAccountService } from './paper-account.service';

/**
 * PaperPositionManagerService tracks paper trading positions from fills.
 *
 * Subscribes to TWO streams:
 *  1. EXECUTION_REPORT  — catches paper market-order fills published by
 *                         the execution engine (exchangeId=paper_trading filter)
 *  2. PAPER_EXECUTION_REPORT — catches paper limit/stop fills published
 *                              directly by PaperOrderBookService
 *
 * Both streams carry ExecutionReportModel-compatible payloads. After each
 * fill, this service:
 *  - Updates the in-memory + Redis paper position
 *  - Recomputes unrealizedPnl (mark-to-market using latest fill price as proxy)
 *  - Publishes PAPER_POSITION_UPDATE for PaperPortfolioManagerService
 *  - Refreshes paper account equity
 *
 * Position model (perpetual futures, one-way mode):
 *   BUY  → LONG or reduces SHORT
 *   SELL → SHORT or reduces LONG
 *
 * Position arithmetic:
 *   Opening:  new avgEntry = (existingQty × avgEntry + fillQty × fillPrice) / totalQty
 *   Closing:  realizedPnl += closedQty × (fillPrice - avgEntry) × direction
 *   Reversal: close old position fully, then open new in opposite direction
 */
@Injectable()
export class PaperPositionManagerService implements OnModuleInit, OnModuleDestroy {
  private readonly context = PaperPositionManagerService.name;
  private readonly cfg: PaperTradingConfig;

  /** In-memory positions keyed by symbol. */
  private readonly positions = new Map<string, PaperPositionState>();

  constructor(
    configService: ConfigService,
    private readonly logger: AppLoggerService,
    private readonly consumer: StreamConsumerService,
    private readonly consumerManager: ConsumerManagerService,
    private readonly publisher: StreamPublisherService,
    private readonly store: PaperStateStoreService,
    private readonly account: PaperAccountService,
    private readonly riskEngine: RiskEngineService,
    private readonly alertEngine: AlertEngineService,
  ) {
    this.cfg = configService.get<PaperTradingConfig>('paperTrading')!;
  }

  async onModuleInit(): Promise<void> {
    if (!this.cfg.enabled) {
      this.logger.warn('Paper Position Manager is DISABLED', this.context);
      return;
    }

    // Restore positions from Redis
    const saved = await this.store.loadAllPositions();
    for (const pos of saved) {
      if (pos.direction !== 'FLAT') this.positions.set(pos.symbol, pos);
    }
    this.logger.log(`Paper positions restored: ${this.positions.size} open`, this.context);

    // Seed lifetime risk stats from fill history if restoreFromRedis() found no
    // persisted data (happens on the first deploy of the lifetime-persistence feature).
    await this.seedRiskStatsIfNeeded();

    // Subscribe to both execution report streams
    await this.registerAndSubscribe(
      STREAM_NAMES.EXECUTION_REPORT,
      `${this.cfg.consumerGroup}-exec`,
      (msg) => this.handleExecutionReport(msg, true /* filterByExchangeId */),
    );

    await this.registerAndSubscribe(
      STREAM_NAMES.PAPER_EXECUTION_REPORT,
      `${this.cfg.consumerGroup}-paper-exec`,
      (msg) => this.handleExecutionReport(msg, false /* already paper */),
    );
  }

  onModuleDestroy(): void {
    // Consumer subscriptions clean up via ConsumerManagerService
  }

  // ── Core processing ──────────────────────────────────────────────────────────

  private async handleExecutionReport(
    msg: ConsumedMessage,
    filterByExchangeId: boolean,
  ): Promise<void> {
    const report = msg.event.payload as unknown as ExecutionReportModel;

    // If consuming the shared EXECUTION_REPORT stream, only process paper fills
    if (
      filterByExchangeId &&
      report.exchangeId !== (ExchangeId.PAPER_TRADING as unknown as typeof report.exchangeId)
    ) {
      return;
    }

    if (!this.isProcessable(report)) return;

    await this.processFill(report);
  }

  private async processFill(report: ExecutionReportModel): Promise<void> {
    const symbol = report.symbol;
    const isBuy = report.side === (OrderSide.BUY as unknown as typeof report.side);
    const fillQty = report.executedQuantity;
    const fillPrice = report.averagePrice;

    const position =
      this.positions.get(symbol) ?? this.createFlatPosition(symbol, report.strategyId);

    let updated: PaperPositionState;

    if (position.direction === 'FLAT') {
      // Opening a new position.
      // `position` may be a previously-closed FLAT state still in the map —
      // it carries the accumulated realizedPnl of all prior trades on this symbol.
      // Explicitly reset it to 0 so the new trade starts with a clean slate.
      // (account.totalRealizedPnl is accumulated separately and is not affected.)
      updated = {
        ...position,
        direction: isBuy ? 'LONG' : 'SHORT',
        quantity: fillQty,
        averageEntryPrice: fillPrice,
        unrealizedPnl: 0,
        realizedPnl: 0,
        updatedAt: Date.now(),
      };
    } else if (
      (position.direction === 'LONG' && isBuy) ||
      (position.direction === 'SHORT' && !isBuy)
    ) {
      // Adding to existing position — weighted average entry
      const totalQty = position.quantity + fillQty;
      const newAvgEntry =
        (position.quantity * position.averageEntryPrice + fillQty * fillPrice) / totalQty;
      updated = {
        ...position,
        quantity: totalQty,
        averageEntryPrice: newAvgEntry,
        unrealizedPnl: 0, // recomputed below
        updatedAt: Date.now(),
      };
    } else {
      // Reducing or reversing position
      const closingQty = Math.min(fillQty, position.quantity);
      const direction = position.direction === 'LONG' ? 1 : -1;
      const realizedPnlFromClose =
        closingQty * (fillPrice - position.averageEntryPrice) * direction;

      const remainingQty = position.quantity - closingQty;
      const reversalQty = fillQty - closingQty;

      updated = {
        ...position,
        direction:
          remainingQty > 0
            ? position.direction
            : reversalQty > 0
              ? isBuy
                ? 'LONG'
                : 'SHORT'
              : 'FLAT',
        quantity: remainingQty > 0 ? remainingQty : reversalQty,
        averageEntryPrice: reversalQty > 0 ? fillPrice : position.averageEntryPrice,
        realizedPnl: position.realizedPnl + realizedPnlFromClose,
        unrealizedPnl: 0,
        updatedAt: Date.now(),
      };
    }

    // Update unrealized PnL using fill price as mark price proxy
    if (updated.direction !== 'FLAT' && updated.quantity > 0) {
      const dir = updated.direction === 'LONG' ? 1 : -1;
      updated = {
        ...updated,
        unrealizedPnl: updated.quantity * (fillPrice - updated.averageEntryPrice) * dir,
      };
    }

    // Persist and broadcast
    this.positions.set(symbol, updated);
    await this.store.savePosition(updated);
    this.account.refreshEquity([...this.positions.values()]);

    // Feed real paper equity into the risk engine so daily-loss and drawdown
    // limits are evaluated against the actual $1k account, not the $100k default.
    const currentEquity = this.account.getState().equity;
    this.riskEngine.recordEquity(currentEquity);

    // Record realised P&L when a position is reduced or closed.
    // This is the only place with position context (entry price, direction) needed
    // to compute gross P&L. The exchange adapter and order-book pass realizedPnl=0
    // to account.applyFill() because they only know notional/commission.
    if (position.direction !== 'FLAT' && (
      (position.direction === 'LONG' && !isBuy) ||
      (position.direction === 'SHORT' && isBuy)
    )) {
      const closingQty = Math.min(fillQty, position.quantity);
      const dir = position.direction === 'LONG' ? 1 : -1;
      const pnl = closingQty * (fillPrice - position.averageEntryPrice) * dir;
      this.riskEngine.recordTrade(pnl);
      // Feed P&L into the account so totalRealizedPnl reflects actual trade results.
      this.account.recordRealizedPnl(pnl);
    }

    await this.publishPositionUpdate(updated, report.requestId);

    // Discord trade alerts (fire-and-forget)
    const wasFlat = position.direction === 'FLAT';
    const isNowFlat = updated.direction === 'FLAT';

    if (wasFlat && !isNowFlat) {
      void this.alertEngine.raise({
        level: AlertLevel.INFO,
        category: AlertCategory.EXECUTION,
        condition: AlertCondition.PAPER_TRADE_OPENED,
        title: `Paper Trade Opened — ${updated.direction} ${symbol}`,
        message: `Opened ${updated.direction} ${updated.quantity} ${symbol} @ $${fillPrice.toFixed(2)} | equity $${currentEquity.toFixed(2)}`,
        source: this.context,
        context: { symbol, direction: updated.direction, quantity: updated.quantity, price: fillPrice, equity: currentEquity },
      });
    } else if (!wasFlat && isNowFlat) {
      void this.alertEngine.raise({
        level: AlertLevel.INFO,
        category: AlertCategory.EXECUTION,
        condition: AlertCondition.PAPER_TRADE_CLOSED,
        title: `Paper Trade Closed — ${symbol}`,
        message: `Closed ${symbol} @ $${fillPrice.toFixed(2)} | realizedPnl $${updated.realizedPnl.toFixed(2)} | equity $${currentEquity.toFixed(2)}`,
        source: this.context,
        context: { symbol, realizedPnl: updated.realizedPnl, price: fillPrice, equity: currentEquity },
      });
    }

    this.logger.log(
      `[PAPER-POSITION] ${updated.direction} ${updated.quantity} ${symbol}@${updated.averageEntryPrice.toFixed(4)} ` +
        `realPnl=${updated.realizedPnl.toFixed(4)} unrealPnl=${updated.unrealizedPnl.toFixed(4)}`,
      this.context,
    );
  }

  /**
   * Seeds the risk engine's lifetime win/loss counters from the fill history
   * stored in Redis. Only runs when the risk engine reports zero total trades
   * (i.e. the `risk:state:lifetime` Redis hash was empty on startup, which
   * happens on the first deploy of the lifetime-persistence feature).
   *
   * Uses the same FIFO average-cost reconstruction as PaperReportService so the
   * seeded win rate matches what the Recent Trades table shows.
   */
  private async seedRiskStatsIfNeeded(): Promise<void> {
    if (this.riskEngine.getTotalTrades() > 0) return; // already restored from Redis

    const fills = await this.store.loadFills(2_000);
    if (fills.length === 0) return;

    // Sort fills chronologically (store returns newest-first).
    const sorted = [...fills].sort((a, b) => a.filledAt - b.filledAt);

    interface OpenPos {
      side: 'LONG' | 'SHORT';
      quantity: number;
      avgEntry: number;
      entryCommission: number;
    }

    const positions = new Map<string, OpenPos>();
    let wins = 0, losses = 0, winPnl = 0, lossPnl = 0;

    for (const fill of sorted) {
      const key = fill.symbol;
      const existing = positions.get(key);
      const isLong = fill.side === 'BUY';

      if (!existing) {
        positions.set(key, {
          side: isLong ? 'LONG' : 'SHORT',
          quantity: fill.filledQuantity,
          avgEntry: fill.fillPrice,
          entryCommission: fill.commission,
        });
      } else if ((existing.side === 'LONG') === isLong) {
        // Adding to the same-side position — weighted average entry.
        const newQty = existing.quantity + fill.filledQuantity;
        positions.set(key, {
          ...existing,
          quantity: newQty,
          avgEntry:
            (existing.quantity * existing.avgEntry + fill.filledQuantity * fill.fillPrice) / newQty,
          entryCommission: existing.entryCommission + fill.commission,
        });
      } else {
        // Closing fill — compute net P&L.
        const closedQty = Math.min(fill.filledQuantity, existing.quantity);
        const dir = existing.side === 'LONG' ? 1 : -1;
        const gross = closedQty * (fill.fillPrice - existing.avgEntry) * dir;
        const net = gross - existing.entryCommission - fill.commission;

        if (net > 0) { wins++; winPnl += net; }
        else if (net < 0) { losses++; lossPnl += Math.abs(net); }

        const remaining = existing.quantity - closedQty;
        if (remaining < 0.000001) {
          positions.delete(key);
        } else {
          positions.set(key, { ...existing, quantity: remaining });
        }
      }
    }

    if (wins + losses > 0) {
      this.riskEngine.seedLifetimeStats({
        totalWins: wins,
        totalLosses: losses,
        totalWinPnl: winPnl,
        totalLossPnl: lossPnl,
      });
    }
  }

  // ── Queries ──────────────────────────────────────────────────────────────────

  getOpenPositions(): PaperPositionState[] {
    return [...this.positions.values()].filter((p) => p.direction !== 'FLAT' && p.quantity > 0);
  }

  getPosition(symbol: string): PaperPositionState | undefined {
    return this.positions.get(symbol);
  }

  // ── Publishing ───────────────────────────────────────────────────────────────

  private async publishPositionUpdate(
    pos: PaperPositionState,
    correlationId: string,
  ): Promise<void> {
    try {
      await this.publisher.publish(STREAM_NAMES.PAPER_POSITION_UPDATE, {
        correlationId,
        eventType: 'PaperPositionUpdate',
        exchange: ExchangeId.PAPER_TRADING,
        symbol: pos.symbol,
        timestamp: pos.updatedAt,
        producer: this.context,
        payload: {
          positionId: pos.positionId,
          exchangeId: ExchangeId.PAPER_TRADING,
          symbol: pos.symbol,
          direction: pos.direction,
          state: pos.direction === 'FLAT' ? 'FLAT' : 'OPEN',
          quantity: pos.quantity,
          averageEntryPrice: pos.averageEntryPrice,
          unrealizedPnl: pos.unrealizedPnl,
          realizedPnl: pos.realizedPnl,
          totalFees: pos.totalFees,
          strategyId: pos.strategyId,
          updatedAt: pos.updatedAt,
        } as Record<string, unknown>,
      });
    } catch (e) {
      this.logger.error(
        `Failed to publish paper position update: ${(e as Error).message}`,
        undefined,
        this.context,
      );
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private isProcessable(report: ExecutionReportModel): boolean {
    return (
      report.executedQuantity > 0 &&
      report.averagePrice > 0 &&
      report.status !== ExecutionStatus.FAILED &&
      report.status !== ExecutionStatus.CANCELLED &&
      report.status !== ExecutionStatus.REJECTED &&
      report.status !== ExecutionStatus.PENDING &&
      report.status !== ExecutionStatus.SUBMITTED &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      report.status !== (ExecutionStatus as any).OPEN
    );
  }

  private createFlatPosition(symbol: string, strategyId: string): PaperPositionState {
    return {
      positionId: `paper:${symbol}`,
      symbol,
      strategyId,
      direction: 'FLAT',
      quantity: 0,
      averageEntryPrice: 0,
      unrealizedPnl: 0,
      realizedPnl: 0,
      totalFees: 0,
      totalFunding: 0,
      openedAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  private async registerAndSubscribe(
    streamName: StreamName,
    groupName: string,
    handler: (msg: ConsumedMessage) => Promise<void>,
  ): Promise<void> {
    await this.consumerManager.registerGroup({
      streamName,
      groupName,
      startId: '0',
    });

    this.consumer.subscribe(streamName, groupName, handler);

    this.logger.log(
      `Paper Position Manager subscribed to ${streamName} as "${groupName}"`,
      this.context,
    );
  }
}
