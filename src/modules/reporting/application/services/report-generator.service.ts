import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { AnalyticsStorageService } from '@modules/analytics/storage/analytics-storage.service';
import { AnalyticsDataCollectorService } from '@modules/analytics/application/services/analytics-data-collector.service';
import { AnalyticsSnapshot } from '@modules/analytics/domain/models/analytics-snapshot.model';

import { ReportConfig } from '../../domain/models/report-config.model';
import { TradingReport } from '../../domain/models/report.model';
import { ReportPeriod } from '../../domain/enums/report-period.enum';
import { ReportStatus } from '../../domain/enums/report-status.enum';
import { ReportExportFormat } from '../../domain/enums/report-export-format.enum';
import {
  NoSnapshotDataError,
  InvalidReportConfigError,
} from '../../domain/errors/reporting.errors';

import { ExecutiveSummaryBuilder } from '../builders/executive-summary.builder';
import { PortfolioPerformanceBuilder } from '../builders/portfolio-performance.builder';
import { TradeSummaryBuilder } from '../builders/trade-summary.builder';
import { RiskSectionBuilder } from '../builders/risk-section.builder';
import { DrawdownAnalysisBuilder } from '../builders/drawdown-analysis.builder';
import { ExecutionQualityBuilder } from '../builders/execution-quality.builder';
import { ExposureAnalysisBuilder } from '../builders/exposure-analysis.builder';
import { RecommendationsBuilder } from '../builders/recommendations.builder';
import { ChartDataBuilder } from '../builders/chart-data.builder';
import { StrategyComparatorService } from './strategy-comparator.service';
import { ReportStorageService } from '../storage/report-storage.service';

/**
 * ReportGeneratorService is the main orchestrator for report generation.
 *
 * Pipeline:
 *   1. Validate config
 *   2. Resolve period dates
 *   3. Load the relevant analytics snapshot(s) from storage
 *   4. Select the primary snapshot (most recent within period)
 *   5. Build all 9 report sections concurrently where possible
 *   6. Build chart data
 *   7. Build strategy comparison (when applicable)
 *   8. Assemble and persist the TradingReport
 *   9. Return the report
 *
 * The generator NEVER:
 *   - Submits orders or modifies strategy state
 *   - Recomputes analytics (it reads from analytics storage)
 *   - Blocks on I/O longer than needed (uses Promise.all)
 */
@Injectable()
export class ReportGeneratorService {
  private readonly context = ReportGeneratorService.name;

  constructor(
    private readonly logger: AppLoggerService,
    private readonly analyticsStorage: AnalyticsStorageService,
    private readonly dataCollector: AnalyticsDataCollectorService,
    private readonly executiveSummaryBuilder: ExecutiveSummaryBuilder,
    private readonly portfolioPerformanceBuilder: PortfolioPerformanceBuilder,
    private readonly tradeSummaryBuilder: TradeSummaryBuilder,
    private readonly riskSectionBuilder: RiskSectionBuilder,
    private readonly drawdownAnalysisBuilder: DrawdownAnalysisBuilder,
    private readonly executionQualityBuilder: ExecutionQualityBuilder,
    private readonly exposureAnalysisBuilder: ExposureAnalysisBuilder,
    private readonly recommendationsBuilder: RecommendationsBuilder,
    private readonly chartDataBuilder: ChartDataBuilder,
    private readonly strategyComparator: StrategyComparatorService,
    private readonly reportStorage: ReportStorageService,
  ) {}

  // ── Public API ────────────────────────────────────────────────────────────────

  /**
   * Generate a new report for the given configuration.
   *
   * @throws InvalidReportConfigError — when config is malformed
   * @throws NoSnapshotDataError      — when no analytics data exists for the period
   */
  async generate(config: ReportConfig): Promise<TradingReport> {
    const startMs = Date.now();
    this.logger.log(`Report generator: starting "${config.period}" report`, this.context);

    // ── 1. Validate ───────────────────────────────────────────────────────────
    this.validate(config);

    // ── 2. Resolve period dates ───────────────────────────────────────────────
    const { periodStartDate, periodEndDate, periodStartMs, periodEndMs } =
      this.resolvePeriodDates(config);

    // ── 3. Load snapshots ─────────────────────────────────────────────────────
    const [snapshots, trades] = await Promise.all([
      this.analyticsStorage.loadSnapshotsByRange(periodStartMs, periodEndMs),
      this.dataCollector.collectTrades(),
    ]);

    // Fall back to latest snapshot when period has no data (e.g. first run of day)
    const pool =
      snapshots.length > 0
        ? snapshots
        : (await this.analyticsStorage.loadLatestSnapshot()) !== null
          ? [(await this.analyticsStorage.loadLatestSnapshot()) as AnalyticsSnapshot]
          : [];

    if (pool.length === 0) {
      throw new NoSnapshotDataError(periodStartDate, periodEndDate);
    }

    // Primary snapshot = most recent within the period
    const primary = pool.sort((a, b) => b.computedAt - a.computedAt)[0]!;
    const snapshotIds = pool.map((s) => s.snapshotId);

    // ── 4. Build sections (independent builders run concurrently) ─────────────
    const executiveSummary = this.executiveSummaryBuilder.build(
      primary,
      config.period,
      config.source,
      periodStartDate,
      periodEndDate,
    );
    const portfolioPerformance = this.portfolioPerformanceBuilder.build(primary);
    const tradeSummary = this.tradeSummaryBuilder.build(primary);
    const riskMetrics = this.riskSectionBuilder.build(primary);
    const drawdownAnalysis = this.drawdownAnalysisBuilder.build(primary);
    const executionQuality = this.executionQualityBuilder.build(primary);
    const exposureAnalysis = this.exposureAnalysisBuilder.build(primary);
    const recommendations = this.recommendationsBuilder.build(primary);
    const charts = this.chartDataBuilder.build(primary, trades);

    // ── 5. Strategy comparison (only when ≥ 2 strategies) ────────────────────
    const strategyComparison =
      config.strategyIds.length >= 2
        ? await this.strategyComparator.compare(config.strategyIds, pool)
        : null;

    const strategyComparisonSection = strategyComparison
      ? {
          strategies: strategyComparison.strategies,
          bestByReturn: strategyComparison.bestByReturn,
          bestBySharpe: strategyComparison.bestBySharpe,
          bestBySortino: strategyComparison.bestBySortino,
          bestByCalmar: strategyComparison.bestByCalmar,
          bestByDrawdown: strategyComparison.bestByDrawdown,
          bestByExpectancy: strategyComparison.bestByExpectancy,
          bestByProfitFactor: strategyComparison.bestByProfitFactor,
        }
      : null;

    // ── 6. Determine report ID and version ────────────────────────────────────
    const { reportId, version } = await this.reportStorage.nextVersion(config);

    // ── 7. Assemble report ────────────────────────────────────────────────────
    const generationDurationMs = Date.now() - startMs;

    const report: TradingReport = {
      reportId,
      version,
      generatedAt: Date.now(),

      title: executiveSummary.title,
      period: config.period,
      source: config.source,
      sessionId: config.sessionId,
      strategyIds: config.strategyIds,

      periodStartDate,
      periodEndDate,
      periodStartMs,
      periodEndMs,

      snapshotIds,

      executiveSummary,
      portfolioPerformance,
      tradeSummary,
      riskMetrics,
      drawdownAnalysis,
      strategyComparison: strategyComparisonSection,
      executionQuality,
      exposureAnalysis,
      recommendations,

      charts,
      formats: config.formats.length > 0 ? config.formats : [ReportExportFormat.JSON],

      status: ReportStatus.COMPLETE,
      generationDurationMs,
    };

    // ── 8. Persist ────────────────────────────────────────────────────────────
    await this.reportStorage.save(report);

    this.logger.log(
      `Report generator: "${report.title}" complete in ${generationDurationMs}ms ` +
        `(${snapshotIds.length} snapshot(s), v${version})`,
      this.context,
    );

    return report;
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private validate(config: ReportConfig): void {
    if (config.period === ReportPeriod.CUSTOM) {
      if (config.fromMs === undefined || config.toMs === undefined) {
        throw new InvalidReportConfigError('ReportPeriod.CUSTOM requires both fromMs and toMs');
      }
      if (config.fromMs >= config.toMs) {
        throw new InvalidReportConfigError('fromMs must be less than toMs');
      }
    }
    if (!config.sessionId) {
      throw new InvalidReportConfigError('sessionId is required');
    }
  }

  private resolvePeriodDates(config: ReportConfig): {
    periodStartDate: string;
    periodEndDate: string;
    periodStartMs: number;
    periodEndMs: number;
  } {
    if (config.period === ReportPeriod.CUSTOM) {
      return {
        periodStartDate: this.msToDate(config.fromMs!),
        periodEndDate: this.msToDate(config.toMs!),
        periodStartMs: config.fromMs!,
        periodEndMs: config.toMs!,
      };
    }

    const ref = config.referenceDate
      ? new Date(config.referenceDate + 'T00:00:00.000Z')
      : new Date();
    // Normalise to midnight UTC
    ref.setUTCHours(0, 0, 0, 0);

    switch (config.period) {
      case ReportPeriod.DAILY: {
        const start = ref.getTime();
        const end = start + 86_400_000 - 1;
        return {
          periodStartDate: this.msToDate(start),
          periodEndDate: this.msToDate(end),
          periodStartMs: start,
          periodEndMs: end,
        };
      }

      case ReportPeriod.WEEKLY: {
        // ISO week: Mon–Sun
        const dow = ref.getUTCDay(); // 0=Sun
        const diff = dow === 0 ? -6 : 1 - dow; // days to go back to Monday
        const mon = new Date(ref.getTime() + diff * 86_400_000);
        const sun = new Date(mon.getTime() + 6 * 86_400_000);
        sun.setUTCHours(23, 59, 59, 999);
        return {
          periodStartDate: this.msToDate(mon.getTime()),
          periodEndDate: this.msToDate(sun.getTime()),
          periodStartMs: mon.getTime(),
          periodEndMs: sun.getTime(),
        };
      }

      case ReportPeriod.MONTHLY: {
        const y = ref.getUTCFullYear();
        const m = ref.getUTCMonth();
        const start = Date.UTC(y, m, 1);
        const end = Date.UTC(y, m + 1, 0, 23, 59, 59, 999);
        return {
          periodStartDate: this.msToDate(start),
          periodEndDate: this.msToDate(end),
          periodStartMs: start,
          periodEndMs: end,
        };
      }

      case ReportPeriod.QUARTERLY: {
        const y = ref.getUTCFullYear();
        const m = ref.getUTCMonth();
        const qStart = Math.floor(m / 3) * 3;
        const start = Date.UTC(y, qStart, 1);
        const end = Date.UTC(y, qStart + 3, 0, 23, 59, 59, 999);
        return {
          periodStartDate: this.msToDate(start),
          periodEndDate: this.msToDate(end),
          periodStartMs: start,
          periodEndMs: end,
        };
      }

      case ReportPeriod.YEARLY: {
        const y = ref.getUTCFullYear();
        const start = Date.UTC(y, 0, 1);
        const end = Date.UTC(y, 11, 31, 23, 59, 59, 999);
        return {
          periodStartDate: this.msToDate(start),
          periodEndDate: this.msToDate(end),
          periodStartMs: start,
          periodEndMs: end,
        };
      }
    }
  }

  private msToDate(ms: number): string {
    return new Date(ms).toISOString().substring(0, 10);
  }
}
