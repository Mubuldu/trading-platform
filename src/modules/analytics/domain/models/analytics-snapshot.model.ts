import { PerformanceMetrics } from './performance-metrics.model';
import { RiskMetricsRecord } from './risk-metrics.model';
import { TradeMetrics } from './trade-metrics.model';
import { ExposureMetrics } from './exposure-metrics.model';
import { ExecutionAnalytics } from './execution-analytics.model';
import { CapitalMetrics } from './capital-metrics.model';
import { RollingMetrics } from './rolling-metrics.model';
import { BenchmarkComparison } from './benchmark-comparison.model';

/**
 * AnalyticsSnapshot is the complete, timestamped analytics output produced by
 * the AnalyticsEngineService. Every field except benchmarks is always present;
 * benchmarks are only present when external data was available at compute time.
 *
 * Snapshots are immutable once created. Each re-computation produces a new
 * snapshot with a new snapshotId; historical snapshots are never mutated.
 */
export interface AnalyticsSnapshot {
  readonly snapshotId: string; // UUID
  readonly sessionId: string; // paper trading session identifier
  readonly strategyId?: string; // per-strategy snapshot, or undefined = portfolio
  readonly computedAt: number; // unix ms

  // ── Metric groups ─────────────────────────────────────────────────────────
  readonly performance: PerformanceMetrics;
  readonly riskMetrics: RiskMetricsRecord;
  readonly tradeMetrics: TradeMetrics;
  readonly exposureMetrics: ExposureMetrics;
  readonly executionAnalytics: ExecutionAnalytics;
  readonly capitalMetrics: CapitalMetrics;
  readonly rollingMetrics: RollingMetrics;

  /** One comparison per benchmark type; populated only when data was available. */
  readonly benchmarkComparisons: BenchmarkComparison[];

  // ── Data provenance ────────────────────────────────────────────────────────
  readonly dataStartTime: number; // unix ms — oldest data point used
  readonly dataEndTime: number; // unix ms — newest data point used
  readonly totalFillsProcessed: number;
  readonly totalDailyRecordsUsed: number;
}

/**
 * AnalyticsSnapshotSummary is a lightweight descriptor stored in the snapshot
 * index — enough to list/filter snapshots without loading the full payload.
 */
export interface AnalyticsSnapshotSummary {
  readonly snapshotId: string;
  readonly sessionId: string;
  readonly strategyId?: string;
  readonly computedAt: number;
  readonly netProfit: number;
  readonly totalReturnPercent: number;
  readonly sharpeRatio: number;
  readonly maxDrawdown: number;
  readonly totalTrades: number;
}
