import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { StreamConsumerService } from '@infrastructure/redis/streams/stream-consumer.service';
import { StreamPublisherService } from '@infrastructure/redis/streams/stream-publisher.service';
import { ConsumerManagerService } from '@infrastructure/redis/streams/consumer-manager.service';
import { STREAM_NAMES } from '@infrastructure/redis/streams/stream-names.constants';
import { ConsumedMessage } from '@infrastructure/redis/streams/stream-event.interface';
import { PortfolioConfig } from '@config/portfolio.config';
import { AllocationMethod } from '../../domain/enums/allocation-method.enum';
import { PositionSummary, PortfolioStateModel } from '../../domain/models/portfolio-state.model';
import { PortfolioExposureModel } from '../../domain/models/portfolio-exposure.model';
import { RiskMetricsModel } from '../../domain/models/portfolio-metrics.model';
import { CapitalAllocationModel } from '../../domain/models/capital-allocation.model';
import { DailyPnlRecord, PerformanceModel } from '../../domain/models/performance.model';
import { PortfolioMetricsService } from './portfolio-metrics.service';
import { PortfolioExposureService } from './portfolio-exposure.service';
import { CapitalAllocationService } from './capital-allocation.service';
import { PortfolioConstraintsService } from './portfolio-constraints.service';
import { PortfolioCacheService } from './portfolio-cache.service';

interface PositionUpdatePayload {
  positionId: string;
  exchangeId: string;
  symbol: string;
  direction: string;
  state: string;
  quantity: number;
  averageEntryPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalFees: number;
  strategyId?: string;
  updatedAt: number;
}

@Injectable()
export class PortfolioManagerService implements OnModuleInit, OnModuleDestroy {
  private readonly context = PortfolioManagerService.name;
  private readonly cfg: PortfolioConfig;

  private readonly positions = new Map<string, PositionSummary>();
  private dailyRecords: DailyPnlRecord[] = [];
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;

  private currentState: PortfolioStateModel | null = null;
  private currentExposure: PortfolioExposureModel | null = null;
  private currentMetrics: RiskMetricsModel | null = null;
  private currentAllocation: CapitalAllocationModel | null = null;

  constructor(
    configService: ConfigService,
    private readonly logger: AppLoggerService,
    private readonly consumer: StreamConsumerService,
    private readonly consumerManager: ConsumerManagerService,
    private readonly publisher: StreamPublisherService,
    private readonly metricsService: PortfolioMetricsService,
    private readonly exposureService: PortfolioExposureService,
    private readonly allocationService: CapitalAllocationService,
    private readonly constraintsService: PortfolioConstraintsService,
    private readonly cache: PortfolioCacheService,
  ) {
    this.cfg = configService.get<PortfolioConfig>('portfolio')!;
  }

  async onModuleInit(): Promise<void> {
    if (!this.cfg.enabled) {
      this.logger.warn('Portfolio Manager is DISABLED', this.context);
      return;
    }

    await this.restore();

    await this.consumerManager.registerGroup({
      streamName: STREAM_NAMES.POSITION_UPDATE,
      groupName: this.cfg.consumerGroup,
      startId: '0',
    });

    this.consumer.subscribe(STREAM_NAMES.POSITION_UPDATE, this.cfg.consumerGroup, (msg) =>
      this.handlePositionUpdate(msg),
    );

    this.snapshotTimer = setInterval(
      () => void this.takeDailySnapshot(),
      this.cfg.snapshotIntervalMs,
    );

    this.logger.log(
      `Portfolio Manager initialized — consuming ${STREAM_NAMES.POSITION_UPDATE} as group "${this.cfg.consumerGroup}"`,
      this.context,
    );
  }

  private async restore(): Promise<void> {
    const [cachedPositions, cachedRecords] = await Promise.all([
      this.cache.loadAllPositions(),
      this.cache.loadDailyPnl(),
    ]);

    for (const p of cachedPositions) this.positions.set(p.positionId, p);
    this.dailyRecords = cachedRecords;

    this.logger.log(
      `Portfolio Manager restored: ${this.positions.size} positions, ${this.dailyRecords.length} daily records`,
      this.context,
    );
  }

  private async handlePositionUpdate(msg: ConsumedMessage): Promise<void> {
    const payload = msg.event.payload as unknown as PositionUpdatePayload;
    if (!payload.positionId || !payload.symbol) return;

    const asset = this.exposureService.extractAsset(payload.symbol);
    const notionalValue = payload.quantity * payload.averageEntryPrice;

    const summary: PositionSummary = {
      positionId: payload.positionId,
      exchangeId: payload.exchangeId,
      symbol: payload.symbol,
      asset,
      strategyId: payload.strategyId ?? 'unknown',
      direction: payload.direction,
      state: payload.state,
      quantity: payload.quantity,
      averageEntryPrice: payload.averageEntryPrice,
      notionalValue,
      unrealizedPnl: payload.unrealizedPnl,
      realizedPnl: payload.realizedPnl,
      totalFees: payload.totalFees,
      updatedAt: payload.updatedAt,
    };

    this.positions.set(summary.positionId, summary);
    await this.cache.savePosition(summary);

    await this.recompute(msg.event.correlationId);
  }

  private async recompute(correlationId: string): Promise<void> {
    const allPositions = Array.from(this.positions.values());
    const openPositions = allPositions.filter((p) => p.state !== 'FLAT' && p.quantity > 0);

    const state = this.buildState(openPositions);
    const exposure = this.exposureService.compute(openPositions);

    const strategies = [...new Set(openPositions.map((p) => p.strategyId))];
    const allocation = this.allocationService.compute(
      this.cfg.allocationMethod as AllocationMethod,
      strategies,
      state.accountEquity,
      { maxPositionSizePercent: this.cfg.maxPositionSizePercent / 100 },
    );

    const metrics = this.metricsService.computeAll(
      this.dailyRecords,
      state.accountEquity,
      this.cfg.riskFreeRateAnnual,
      this.cfg.tradingDaysPerYear,
    );

    const performance = this.buildPerformance();

    const violations = this.constraintsService.check(state, exposure, {
      maxExposurePercent: this.cfg.maxExposurePercent,
      maxLeverage: this.cfg.maxLeverage,
      maxAssetAllocationPercent: this.cfg.maxAssetAllocationPercent,
    });

    if (violations.length > 0) {
      this.logger.warn(
        `Portfolio constraint violations: ${violations.map((v) => v.message).join('; ')}`,
        this.context,
      );
    }

    this.currentState = state;
    this.currentExposure = exposure;
    this.currentMetrics = metrics;
    this.currentAllocation = allocation;

    await this.cache.saveState(state);

    await Promise.all([
      this.publishPortfolioUpdate(state, exposure, allocation, correlationId),
      this.publishMetrics(metrics, performance, correlationId),
      this.publishRisk(metrics, exposure, violations, correlationId),
    ]);
  }

  private buildState(openPositions: PositionSummary[]): PortfolioStateModel {
    const equity = this.cfg.defaultEquityUsd;
    const totalExposure = openPositions.reduce((s, p) => s + p.notionalValue, 0);
    const unrealizedPnl = openPositions.reduce((s, p) => s + p.unrealizedPnl, 0);
    const realizedPnl = openPositions.reduce((s, p) => s + p.realizedPnl, 0);
    const totalFees = openPositions.reduce((s, p) => s + p.totalFees, 0);
    const leverage = equity > 0 ? totalExposure / equity : 0;

    return {
      accountEquity: equity,
      availableBalance: Math.max(0, equity - totalExposure),
      marginUsed: totalExposure,
      buyingPower: Math.max(0, equity * this.cfg.maxLeverage - totalExposure),
      realizedPnl,
      unrealizedPnl,
      totalFees,
      totalFunding: 0,
      netPnl: realizedPnl + unrealizedPnl - totalFees,
      totalExposure,
      totalLeverage: leverage,
      openPositionCount: openPositions.length,
      positions: openPositions,
      snapshotAt: Date.now(),
    };
  }

  private buildPerformance(): PerformanceModel {
    const now = Date.now();
    const daily = this.metricsService.computePeriodStats(
      this.metricsService.sliceByDays(this.dailyRecords, 1),
    );
    const weekly = this.metricsService.computePeriodStats(
      this.metricsService.sliceByDays(this.dailyRecords, 7),
    );
    const monthly = this.metricsService.computePeriodStats(
      this.metricsService.sliceByDays(this.dailyRecords, 30),
    );
    const yearly = this.metricsService.computePeriodStats(
      this.metricsService.sliceByDays(this.dailyRecords, 365),
    );
    const lifetime = this.metricsService.computePeriodStats(this.dailyRecords);
    return { daily, weekly, monthly, yearly, lifetime, computedAt: now };
  }

  private async takeDailySnapshot(): Promise<void> {
    const state = this.currentState;
    if (!state) return;

    const today = new Date().toISOString().slice(0, 10);
    const prevEquity =
      this.dailyRecords.length > 0
        ? this.dailyRecords[this.dailyRecords.length - 1].equity
        : this.cfg.defaultEquityUsd;
    const netPnl = state.netPnl;
    const returnPercent = prevEquity > 0 ? (netPnl / prevEquity) * 100 : 0;

    const record: DailyPnlRecord = {
      date: today,
      realizedPnl: state.realizedPnl,
      unrealizedPnl: state.unrealizedPnl,
      fees: state.totalFees,
      netPnl,
      equity: state.accountEquity + netPnl,
      returnPercent,
    };

    const existing = this.dailyRecords.findIndex((r) => r.date === today);
    if (existing >= 0) this.dailyRecords[existing] = record;
    else this.dailyRecords.push(record);

    if (this.dailyRecords.length > 400) this.dailyRecords = this.dailyRecords.slice(-400);

    await this.cache.appendDailyRecord(record);
    this.logger.debug(
      `Daily snapshot saved for ${today}: netPnl=${netPnl.toFixed(2)}`,
      this.context,
    );
  }

  private async publishPortfolioUpdate(
    state: PortfolioStateModel,
    exposure: PortfolioExposureModel,
    allocation: CapitalAllocationModel,
    correlationId: string,
  ): Promise<void> {
    try {
      await this.publisher.publish(STREAM_NAMES.PORTFOLIO_UPDATE, {
        correlationId,
        eventType: 'PortfolioUpdate',
        exchange: 'ALL',
        symbol: 'ALL',
        timestamp: state.snapshotAt,
        producer: this.context,
        payload: {
          accountEquity: state.accountEquity,
          availableBalance: state.availableBalance,
          marginUsed: state.marginUsed,
          buyingPower: state.buyingPower,
          realizedPnl: state.realizedPnl,
          unrealizedPnl: state.unrealizedPnl,
          totalFees: state.totalFees,
          totalFunding: state.totalFunding,
          netPnl: state.netPnl,
          totalExposure: state.totalExposure,
          totalLeverage: state.totalLeverage,
          openPositionCount: state.openPositionCount,
          exposure: {
            bySymbol: exposure.bySymbol,
            byAsset: exposure.byAsset,
            byExchange: exposure.byExchange,
            byStrategy: exposure.byStrategy,
            byDirection: exposure.byDirection,
          },
          allocation: allocation.allocations,
          snapshotAt: state.snapshotAt,
        } as Record<string, unknown>,
      });
    } catch (e) {
      this.logger.error(
        `Failed to publish portfolio:update: ${(e as Error).message}`,
        undefined,
        this.context,
      );
    }
  }

  private async publishMetrics(
    metrics: RiskMetricsModel,
    performance: PerformanceModel,
    correlationId: string,
  ): Promise<void> {
    try {
      await this.publisher.publish(STREAM_NAMES.PORTFOLIO_METRICS, {
        correlationId,
        eventType: 'PortfolioMetrics',
        exchange: 'ALL',
        symbol: 'ALL',
        timestamp: metrics.computedAt,
        producer: this.context,
        payload: {
          riskMetrics: {
            sharpeRatio: metrics.sharpeRatio,
            sortinoRatio: metrics.sortinoRatio,
            calmarRatio: metrics.calmarRatio,
            maxDrawdown: metrics.maxDrawdown,
            maxDrawdownAbsolute: metrics.maxDrawdownAbsolute,
            rollingDrawdown: metrics.rollingDrawdown,
            volatilityAnnualized: metrics.volatilityAnnualized,
            recoveryFactor: metrics.recoveryFactor,
            profitFactor: metrics.profitFactor,
            expectancy: metrics.expectancy,
          },
          performance: {
            daily: performance.daily,
            weekly: performance.weekly,
            monthly: performance.monthly,
            yearly: performance.yearly,
            lifetime: performance.lifetime,
          },
        } as Record<string, unknown>,
      });
    } catch (e) {
      this.logger.error(
        `Failed to publish portfolio:metrics: ${(e as Error).message}`,
        undefined,
        this.context,
      );
    }
  }

  private async publishRisk(
    metrics: RiskMetricsModel,
    exposure: PortfolioExposureModel,
    violations: ReturnType<PortfolioConstraintsService['check']>,
    correlationId: string,
  ): Promise<void> {
    try {
      await this.publisher.publish(STREAM_NAMES.PORTFOLIO_RISK, {
        correlationId,
        eventType: 'PortfolioRisk',
        exchange: 'ALL',
        symbol: 'ALL',
        timestamp: Date.now(),
        producer: this.context,
        payload: {
          maxDrawdown: metrics.maxDrawdown,
          rollingDrawdown: metrics.rollingDrawdown,
          volatilityAnnualized: metrics.volatilityAnnualized,
          totalGrossExposure: exposure.totalGrossExposure,
          totalNetExposure: exposure.totalNetExposure,
          violations: violations.map((v) => ({
            constraint: v.constraint,
            message: v.message,
            current: v.current,
            limit: v.limit,
          })),
          hasViolations: violations.length > 0,
        } as Record<string, unknown>,
      });
    } catch (e) {
      this.logger.error(
        `Failed to publish portfolio:risk: ${(e as Error).message}`,
        undefined,
        this.context,
      );
    }
  }

  onModuleDestroy(): void {
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
  }

  // ── Public query API ────────────────────────────────────────────────────────

  getState(): PortfolioStateModel | null {
    return this.currentState;
  }

  getExposure(): PortfolioExposureModel | null {
    return this.currentExposure;
  }

  getMetrics(): RiskMetricsModel | null {
    return this.currentMetrics;
  }

  getAllocation(): CapitalAllocationModel | null {
    return this.currentAllocation;
  }

  getDailyRecords(): DailyPnlRecord[] {
    return [...this.dailyRecords];
  }

  getOpenPositions(): PositionSummary[] {
    return Array.from(this.positions.values()).filter((p) => p.state !== 'FLAT' && p.quantity > 0);
  }
}
