import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { StreamConsumerService } from '@infrastructure/redis/streams/stream-consumer.service';
import { StreamPublisherService } from '@infrastructure/redis/streams/stream-publisher.service';
import { ConsumerManagerService } from '@infrastructure/redis/streams/consumer-manager.service';
import { STREAM_NAMES } from '@infrastructure/redis/streams/stream-names.constants';
import { ConsumedMessage } from '@infrastructure/redis/streams/stream-event.interface';
import { PaperTradingConfig } from '@config/paper-trading.config';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import {
  PaperPositionState,
  PaperDailyRecord,
} from '../../domain/models/paper-account-state.model';
import { PaperStateStoreService } from '../../infrastructure/store/paper-state-store.service';
import { PaperAccountService } from './paper-account.service';

interface PositionUpdatePayload {
  positionId: string;
  symbol: string;
  direction: string;
  state: string;
  quantity: number;
  averageEntryPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalFees: number;
  strategyId: string;
  updatedAt: number;
}

/**
 * PaperPortfolioManagerService aggregates paper positions into portfolio-level
 * metrics and broadcasts them on the PAPER_PORTFOLIO_UPDATE stream.
 *
 * Consumes: PAPER_POSITION_UPDATE
 * Publishes: PAPER_PORTFOLIO_UPDATE, PAPER_PORTFOLIO_METRICS
 *
 * Daily snapshots are taken on a timer and stored as PaperDailyRecord entries.
 * These are the raw material for PaperReportService's PnL reporting.
 *
 * Isolated from live: uses only paper:* Redis keys and paper:* streams.
 * Never touches POSITION_UPDATE, PORTFOLIO_UPDATE, or live Redis namespaces.
 */
@Injectable()
export class PaperPortfolioManagerService implements OnModuleInit {
  private readonly context = PaperPortfolioManagerService.name;
  private readonly cfg: PaperTradingConfig;

  private readonly positions = new Map<string, PaperPositionState>();
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private lastSnapshotDate = '';

  constructor(
    configService: ConfigService,
    private readonly logger: AppLoggerService,
    private readonly consumer: StreamConsumerService,
    private readonly consumerManager: ConsumerManagerService,
    private readonly publisher: StreamPublisherService,
    private readonly store: PaperStateStoreService,
    private readonly account: PaperAccountService,
  ) {
    this.cfg = configService.get<PaperTradingConfig>('paperTrading')!;
  }

  async onModuleInit(): Promise<void> {
    if (!this.cfg.enabled) {
      this.logger.warn('Paper Portfolio Manager is DISABLED', this.context);
      return;
    }

    // Restore positions
    const saved = await this.store.loadAllPositions();
    for (const pos of saved) {
      if (pos.direction !== 'FLAT') this.positions.set(pos.symbol, pos);
    }

    const groupName = `${this.cfg.consumerGroup}-portfolio`;
    await this.consumerManager.registerGroup({
      streamName: STREAM_NAMES.PAPER_POSITION_UPDATE,
      groupName,
      startId: '0',
    });

    this.consumer.subscribe(STREAM_NAMES.PAPER_POSITION_UPDATE, groupName, (msg) =>
      this.handlePositionUpdate(msg),
    );

    // Daily snapshot timer — fires every 5 minutes, but only records once per calendar day
    this.snapshotTimer = setInterval(() => void this.maybeTakeDailySnapshot(), 5 * 60 * 1000);

    this.logger.log(
      `Paper Portfolio Manager initialized — consuming ${STREAM_NAMES.PAPER_POSITION_UPDATE}`,
      this.context,
    );
  }

  // ── Position update handler ──────────────────────────────────────────────────

  private async handlePositionUpdate(msg: ConsumedMessage): Promise<void> {
    const payload = msg.event.payload as unknown as PositionUpdatePayload;
    if (!payload.symbol) return;

    const pos: PaperPositionState = {
      positionId: payload.positionId,
      symbol: payload.symbol,
      strategyId: payload.strategyId ?? 'unknown',
      direction: payload.direction as 'LONG' | 'SHORT' | 'FLAT',
      quantity: payload.quantity,
      averageEntryPrice: payload.averageEntryPrice,
      unrealizedPnl: payload.unrealizedPnl,
      realizedPnl: payload.realizedPnl,
      totalFees: payload.totalFees,
      totalFunding: 0,
      openedAt: 0,
      updatedAt: payload.updatedAt,
    };

    if (pos.direction === 'FLAT' || pos.quantity === 0) {
      this.positions.delete(pos.symbol);
    } else {
      this.positions.set(pos.symbol, pos);
    }

    await this.publish(msg.event.correlationId);
  }

  // ── Publishing ───────────────────────────────────────────────────────────────

  private async publish(correlationId: string): Promise<void> {
    const openPositions = [...this.positions.values()];
    const accountState = this.account.getState();

    const totalUnrealizedPnl = openPositions.reduce((s, p) => s + p.unrealizedPnl, 0);
    const totalRealizedPnl = openPositions.reduce((s, p) => s + p.realizedPnl, 0);
    const totalFees = openPositions.reduce((s, p) => s + p.totalFees, 0);
    const totalExposure = openPositions.reduce((s, p) => s + p.quantity * p.averageEntryPrice, 0);
    const netPnl = totalRealizedPnl + totalUnrealizedPnl - totalFees;
    const equity = accountState.equity;
    const drawdown =
      equity < accountState.peakEquity
        ? (accountState.peakEquity - equity) / accountState.peakEquity
        : 0;

    try {
      await this.publisher.publish(STREAM_NAMES.PAPER_PORTFOLIO_UPDATE, {
        correlationId,
        eventType: 'PaperPortfolioUpdate',
        exchange: ExchangeId.PAPER_TRADING,
        symbol: 'ALL',
        timestamp: Date.now(),
        producer: this.context,
        payload: {
          balance: accountState.balance,
          equity,
          peakEquity: accountState.peakEquity,
          lockedBalance: accountState.lockedBalance,
          totalRealizedPnl: accountState.totalRealizedPnl,
          totalUnrealizedPnl,
          totalFees: accountState.totalFees,
          totalFunding: accountState.totalFunding,
          netPnl,
          totalExposure,
          openPositionCount: openPositions.length,
          currentDrawdown: drawdown,
          tradeCount: accountState.tradeCount,
          positions: openPositions.map((p) => ({
            symbol: p.symbol,
            direction: p.direction,
            quantity: p.quantity,
            averageEntryPrice: p.averageEntryPrice,
            unrealizedPnl: p.unrealizedPnl,
            realizedPnl: p.realizedPnl,
            exposure: p.quantity * p.averageEntryPrice,
          })),
          snapshotAt: Date.now(),
        } as Record<string, unknown>,
      });
    } catch (e) {
      this.logger.error(
        `Failed to publish paper portfolio update: ${(e as Error).message}`,
        undefined,
        this.context,
      );
    }
  }

  // ── Daily snapshot ───────────────────────────────────────────────────────────

  private async maybeTakeDailySnapshot(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    if (today === this.lastSnapshotDate) return;
    this.lastSnapshotDate = today;

    const accountState = this.account.getState();
    const openPositions = [...this.positions.values()];
    const unrealizedPnl = openPositions.reduce((s, p) => s + p.unrealizedPnl, 0);

    // Fetch yesterday's record for open equity
    const records = await this.store.loadDailyRecords(2);
    const prevEquity =
      records.length > 0 ? records[records.length - 1].closeEquity : this.cfg.initialBalanceUsd;
    const closeEquity = accountState.equity;
    const netPnl = closeEquity - prevEquity;
    const returnPct = prevEquity > 0 ? (netPnl / prevEquity) * 100 : 0;

    const record: PaperDailyRecord = {
      date: today,
      openEquity: prevEquity,
      closeEquity,
      realizedPnl: accountState.totalRealizedPnl,
      unrealizedPnl,
      fees: accountState.totalFees,
      funding: accountState.totalFunding,
      netPnl,
      returnPercent: returnPct,
      tradeCount: accountState.tradeCount,
    };

    await this.store.appendOrUpdateDaily(record);
    this.logger.debug(
      `Paper daily snapshot saved: ${today} netPnl=${netPnl.toFixed(2)}`,
      this.context,
    );
  }

  // ── Public queries ───────────────────────────────────────────────────────────

  getOpenPositions(): PaperPositionState[] {
    return [...this.positions.values()];
  }

  getEquity(): number {
    return this.account.getState().equity;
  }

  getPeakEquity(): number {
    return this.account.getState().peakEquity;
  }

  getCurrentDrawdown(): number {
    const { equity, peakEquity } = this.account.getState();
    return peakEquity > 0 ? Math.max(0, (peakEquity - equity) / peakEquity) : 0;
  }

  onModuleDestroy(): void {
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
  }
}
