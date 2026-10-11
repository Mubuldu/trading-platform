import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { AnalyticsDataCollectorService } from './analytics-data-collector.service';
import { AnalyticsStorageService } from '../../storage/analytics-storage.service';
import { PerformanceCalculator } from '../calculators/performance.calculator';
import { RiskMetricsCalculator } from '../calculators/risk-metrics.calculator';
import { TradeMetricsCalculator } from '../calculators/trade-metrics.calculator';
import { ExposureCalculator } from '../calculators/exposure.calculator';
import { ExecutionAnalyticsCalculator } from '../calculators/execution-analytics.calculator';
import { CapitalMetricsCalculator } from '../calculators/capital-metrics.calculator';
import { RollingMetricsCalculator } from '../calculators/rolling-metrics.calculator';
import { BenchmarkCalculator } from '../calculators/benchmark.calculator';
import { AnalyticsSnapshot } from '../../domain/models/analytics-snapshot.model';
import { AnalyticsEquityPoint } from '../../domain/models/analytics-trade.model';
import {
  BenchmarkComparison,
  BenchmarkDailyReturn,
} from '../../domain/models/benchmark-comparison.model';
import { BenchmarkType } from '../../domain/enums/benchmark-type.enum';

/**
 * AnalyticsEngineService orchestrates the full analytics computation pipeline.
 *
 * Pipeline:
 *   1. Collect raw data via AnalyticsDataCollectorService
 *   2. Run all 8 calculators concurrently
 *   3. Assemble AnalyticsSnapshot
 *   4. Persist via AnalyticsStorageService
 *   5. Return the snapshot
 *
 * This service NEVER:
 *   - Submits orders
 *   - Modifies strategy state
 *   - Writes to paper trading Redis keys
 *
 * Thread safety: concurrent compute() calls are safe — each call is stateless
 * and reads from Redis atomically. The storage layer deduplicates by snapshotId.
 */
@Injectable()
export class AnalyticsEngineService {
  private readonly context = AnalyticsEngineService.name;
  private static readonly SESSION_ID = 'paper_trading_default';

  constructor(
    private readonly logger: AppLoggerService,
    private readonly collector: AnalyticsDataCollectorService,
    private readonly storage: AnalyticsStorageService,
    private readonly performanceCalc: PerformanceCalculator,
    private readonly riskMetricsCalc: RiskMetricsCalculator,
    private readonly tradeMetricsCalc: TradeMetricsCalculator,
    private readonly exposureCalc: ExposureCalculator,
    private readonly executionCalc: ExecutionAnalyticsCalculator,
    private readonly capitalCalc: CapitalMetricsCalculator,
    private readonly rollingCalc: RollingMetricsCalculator,
    private readonly benchmarkCalc: BenchmarkCalculator,
  ) {}

  // ── Primary compute ──────────────────────────────────────────────────────────

  /**
   * Compute a full analytics snapshot and persist it.
   *
   * @param benchmarkData — optional benchmark data for each BenchmarkType.
   *                        When empty, benchmark comparisons are omitted.
   */
  async compute(
    benchmarkData: Partial<Record<BenchmarkType, BenchmarkDailyReturn[]>> = {},
  ): Promise<AnalyticsSnapshot> {
    const startMs = Date.now();
    this.logger.log('Analytics engine: starting computation', this.context);

    // ── 1. Collect data ────────────────────────────────────────────────────────
    const [trades, fills, equityPoints, positions, dailyCapital, fillCount] = await Promise.all([
      this.collector.collectTrades(),
      this.collector.collectFills(),
      this.collector.collectEquityPoints(),
      this.collector.collectPositionSnapshots(),
      this.collector.collectDailyCapitalRecords(),
      this.collector.getTotalFillCount(),
    ]);

    const accountState = this.collector.getCurrentAccountState();

    // ── 2. Compute performance metrics ─────────────────────────────────────────
    const startTime = trades.length > 0 ? trades[0]!.entryTime : accountState.startedAt;
    const endTime = Date.now();
    const initialCapital = accountState.equity - accountState.totalRealizedPnl;

    // Estimate max absolute drawdown from equity curve
    const maxAbsDrawdown = this.computeMaxAbsDrawdown(equityPoints, initialCapital);

    const performance = this.performanceCalc.compute(
      trades,
      initialCapital,
      accountState.equity,
      startTime,
      endTime,
      maxAbsDrawdown,
    );

    // ── 3. Compute risk metrics ────────────────────────────────────────────────
    const riskMetrics = this.riskMetricsCalc.compute(equityPoints, trades);

    // ── 4. Compute trade metrics ───────────────────────────────────────────────
    const tradeMetrics = this.tradeMetricsCalc.compute(trades);

    // ── 5. Compute exposure metrics ────────────────────────────────────────────
    const exposureMetrics = this.exposureCalc.compute(positions, accountState.equity);

    // ── 6. Compute execution analytics ────────────────────────────────────────
    const executionAnalytics = this.executionCalc.compute(fills);

    // ── 7. Compute capital metrics ─────────────────────────────────────────────
    const capitalMetrics = this.capitalCalc.compute(
      dailyCapital,
      accountState.equity,
      accountState.balance,
      initialCapital,
      exposureMetrics.grossExposure,
      accountState.lockedBalance,
    );

    // ── 8. Compute rolling metrics ─────────────────────────────────────────────
    const rollingMetrics = this.rollingCalc.compute(equityPoints, trades);

    // ── 9. Compute benchmark comparisons (optional) ────────────────────────────
    const benchmarkComparisons = this.computeBenchmarks(equityPoints, benchmarkData);

    // ── 10. Assemble snapshot ──────────────────────────────────────────────────
    const dataStartTime = equityPoints.length > 0 ? equityPoints[0]!.timestamp : startTime;
    const dataEndTime =
      equityPoints.length > 0 ? equityPoints[equityPoints.length - 1]!.timestamp : endTime;

    const snapshot: AnalyticsSnapshot = {
      snapshotId: randomUUID(),
      sessionId: AnalyticsEngineService.SESSION_ID,
      computedAt: Date.now(),
      performance,
      riskMetrics,
      tradeMetrics,
      exposureMetrics,
      executionAnalytics,
      capitalMetrics,
      rollingMetrics,
      benchmarkComparisons,
      dataStartTime,
      dataEndTime,
      totalFillsProcessed: fillCount,
      totalDailyRecordsUsed: dailyCapital.length,
    };

    // ── 11. Persist ────────────────────────────────────────────────────────────
    // Wrap in try/catch so a storage failure never prevents the caller from
    // receiving the computed snapshot (e.g. for in-process consumption).
    // AnalyticsStorageService already suppresses its own errors; this guard is
    // a belt-and-suspenders safety net for unexpected rejections.
    try {
      await this.storage.saveSnapshot(snapshot);
    } catch (err) {
      this.logger.warn(
        `Analytics engine: snapshot persistence failed — ${(err as Error).message}`,
        this.context,
      );
    }

    const elapsedMs = Date.now() - startMs;
    this.logger.log(
      `Analytics engine: computation complete in ${elapsedMs}ms ` +
        `(${trades.length} trades, ${fills.length} fills, ${equityPoints.length} equity points)`,
      this.context,
    );

    return snapshot;
  }

  /** Returns the most recently computed snapshot, or null if none exists. */
  async getLatestSnapshot(): Promise<AnalyticsSnapshot | null> {
    return this.storage.loadLatestSnapshot();
  }

  /** Returns all historical snapshots in reverse-chronological order. */
  async getSnapshotHistory(limit = 100): Promise<AnalyticsSnapshot[]> {
    return this.storage.loadSnapshots(limit);
  }

  /** Returns all historical snapshots within the given time range. */
  async getSnapshotRange(fromMs: number, toMs: number): Promise<AnalyticsSnapshot[]> {
    return this.storage.loadSnapshotsByRange(fromMs, toMs);
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private computeMaxAbsDrawdown(
    equityPoints: AnalyticsEquityPoint[],
    initialCapital: number,
  ): number {
    let peak = initialCapital;
    let maxAbsDrawdown = 0;
    for (const p of equityPoints) {
      if (p.equity > peak) peak = p.equity;
      const drawdown = peak - p.equity;
      if (drawdown > maxAbsDrawdown) maxAbsDrawdown = drawdown;
    }
    return maxAbsDrawdown;
  }

  private computeBenchmarks(
    equityPoints: AnalyticsEquityPoint[],
    benchmarkData: Partial<Record<BenchmarkType, BenchmarkDailyReturn[]>>,
  ): BenchmarkComparison[] {
    const comparisons = [];

    // Buy & Hold is always computable from equity points
    if (equityPoints.length >= 2) {
      comparisons.push(
        this.benchmarkCalc.compare(equityPoints, BenchmarkType.BUY_AND_HOLD, 'Buy & Hold', []),
      );
    }

    // External benchmark data (BTC, ETH, SPX, CUSTOM)
    for (const [type, returns] of Object.entries(benchmarkData) as [
      BenchmarkType,
      BenchmarkDailyReturn[],
    ][]) {
      if (returns && returns.length > 0) {
        comparisons.push(this.benchmarkCalc.compare(equityPoints, type, type, returns));
      }
    }

    return comparisons;
  }
}
