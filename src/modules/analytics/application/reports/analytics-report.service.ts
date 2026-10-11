import { Injectable } from '@nestjs/common';
import { AnalyticsEngineService } from '../services/analytics-engine.service';
import { AnalyticsStorageService } from '../../storage/analytics-storage.service';
import {
  AnalyticsSnapshot,
  AnalyticsSnapshotSummary,
} from '../../domain/models/analytics-snapshot.model';
import { BenchmarkType } from '../../domain/enums/benchmark-type.enum';
import { BenchmarkDailyReturn } from '../../domain/models/benchmark-comparison.model';

export interface AnalyticsSummaryReport {
  readonly snapshotId: string;
  readonly computedAt: number;

  // Top-level numbers
  readonly netProfit: number;
  readonly totalReturnPercent: number;
  readonly annualizedReturnPercent: number;
  readonly sharpeRatio: number;
  readonly sortinoRatio: number;
  readonly calmarRatio: number;
  readonly maxDrawdown: number;
  readonly profitFactor: number;
  readonly winRate: number;
  readonly expectancy: number;
  readonly totalTrades: number;

  // 30-day rolling
  readonly rolling30dReturn: number;
  readonly rolling30dSharpe: number;

  // Exposure
  readonly grossExposure: number;
  readonly netExposure: number;
  readonly openPositions: number;

  // Execution
  readonly averageSlippage: number;
  readonly averageLatencyMs: number;
}

/**
 * AnalyticsReportService provides higher-level report generation on top of
 * the raw analytics engine.
 *
 * Reports are assembled from the latest persisted snapshot (no recomputation).
 * Call AnalyticsEngineService.compute() first to ensure data is fresh.
 */
@Injectable()
export class AnalyticsReportService {
  constructor(
    private readonly engine: AnalyticsEngineService,
    private readonly storage: AnalyticsStorageService,
  ) {}

  // ── On-demand computation ────────────────────────────────────────────────────

  /**
   * Trigger a full analytics recomputation and return the new snapshot.
   * This is the primary entry point for automated refresh tasks.
   */
  async refresh(
    benchmarkData: Partial<Record<BenchmarkType, BenchmarkDailyReturn[]>> = {},
  ): Promise<AnalyticsSnapshot> {
    return this.engine.compute(benchmarkData);
  }

  // ── Read from storage ────────────────────────────────────────────────────────

  async getLatestSnapshot(): Promise<AnalyticsSnapshot | null> {
    return this.storage.loadLatestSnapshot();
  }

  async getSummaryReport(): Promise<AnalyticsSummaryReport | null> {
    const snapshot = await this.storage.loadLatestSnapshot();
    if (!snapshot) return null;
    return this.toSummaryReport(snapshot);
  }

  async getSnapshotHistory(limit = 50): Promise<AnalyticsSnapshot[]> {
    return this.storage.loadSnapshots(limit);
  }

  async getSnapshotsByRange(fromMs: number, toMs: number): Promise<AnalyticsSnapshot[]> {
    return this.storage.loadSnapshotsByRange(fromMs, toMs);
  }

  async getIndex(limit = 100): Promise<AnalyticsSnapshotSummary[]> {
    return this.storage.loadSummaries(limit);
  }

  async getSnapshotCount(): Promise<number> {
    return this.storage.countSnapshots();
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private toSummaryReport(snapshot: AnalyticsSnapshot): AnalyticsSummaryReport {
    const { performance, riskMetrics, exposureMetrics, executionAnalytics, rollingMetrics } =
      snapshot;

    return {
      snapshotId: snapshot.snapshotId,
      computedAt: snapshot.computedAt,
      netProfit: performance.netProfit,
      totalReturnPercent: performance.totalReturnPercent,
      annualizedReturnPercent: performance.annualizedReturnPercent,
      sharpeRatio: riskMetrics.sharpeRatio,
      sortinoRatio: riskMetrics.sortinoRatio,
      calmarRatio: riskMetrics.calmarRatio,
      maxDrawdown: riskMetrics.maxDrawdown,
      profitFactor: performance.profitFactor,
      winRate: performance.winningPercent,
      expectancy: performance.expectancy,
      totalTrades: performance.totalTrades,
      rolling30dReturn: rollingMetrics.thirtyDay.totalReturnPercent,
      rolling30dSharpe: rollingMetrics.thirtyDay.sharpeRatio,
      grossExposure: exposureMetrics.grossExposure,
      netExposure: exposureMetrics.netExposure,
      openPositions: exposureMetrics.totalPositionCount,
      averageSlippage: executionAnalytics.averageSlippage,
      averageLatencyMs: executionAnalytics.averageLatencyMs,
    };
  }
}
