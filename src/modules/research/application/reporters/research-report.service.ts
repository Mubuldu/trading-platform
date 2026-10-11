import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { ExperimentMetrics, ExperimentResult } from '../../domain/models/experiment-result.model';
import { Experiment } from '../../domain/models/experiment.model';
import { ExperimentStorageService } from '../../storage/experiment-storage.service';
import { ExperimentStatus } from '../../domain/enums/experiment-status.enum';
import { PromotionStage } from '../../domain/enums/promotion-stage.enum';

// ─── Report Types ─────────────────────────────────────────────────────────────

export type RankingMetric =
  | 'sharpeRatio'
  | 'sortinoRatio'
  | 'calmarRatio'
  | 'omegaRatio'
  | 'totalReturnPercent'
  | 'annualizedReturnPercent'
  | 'maxDrawdownPercent'
  | 'expectancy'
  | 'profitFactor';

export interface RankedExperiment {
  readonly rank: number;
  readonly experiment: Experiment;
  readonly result: ExperimentResult;
  /** Composite score used for ranking (higher = better). */
  readonly score: number;
  /** Whether this experiment passes the p < 0.05 statistical significance test. */
  readonly isStatisticallyValid: boolean;
}

export interface ReportFilter {
  /** Only include experiments at these promotion stages. */
  readonly stages?: PromotionStage[];
  /** Only include experiments with these tags (OR logic — any match). */
  readonly tags?: string[];
  /** Only include experiments created after this timestamp. */
  readonly createdAfterMs?: number;
  /** Only include experiments created before this timestamp. */
  readonly createdBeforeMs?: number;
  /**
   * When true, include statistically invalid experiments in the list but mark them.
   * When false (default), statistically invalid experiments are excluded entirely.
   */
  readonly includeInvalid?: boolean;
}

export interface ComparisonEntry {
  readonly experimentId: string;
  readonly name: string;
  readonly metrics: ExperimentMetrics;
  readonly isStatisticallyValid: boolean;
  readonly promotionStage: PromotionStage;
}

export interface ResearchReport {
  /** Ranked list of experiments — rank 1 = best. */
  readonly ranked: RankedExperiment[];

  /** Experiments excluded because p ≥ 0.05. */
  readonly statisticallyRejected: ComparisonEntry[];

  /** Experiments that completed but had no associated result. */
  readonly missingResults: string[];

  /** Plain-text metric comparison table (all ranked experiments). */
  readonly comparisonTable: ComparisonEntry[];

  readonly rankingMetric: RankingMetric;
  readonly generatedAt: Date;
  readonly totalEvaluated: number;
  readonly totalRejected: number;
}

export interface ReportConfig {
  /** Primary metric for ranking. Default: sharpeRatio. */
  readonly rankingMetric?: RankingMetric;
  /**
   * Whether higher = better for the chosen metric.
   * Automatically detected for built-in metrics if omitted.
   */
  readonly higherIsBetter?: boolean;
  /** Maximum entries in the ranked list. Default: 50. */
  readonly topN?: number;
  /** Composite score weights (must sum to 1.0). See buildCompositeScore. */
  readonly compositeWeights?: CompositeWeights;
  readonly filter?: ReportFilter;
}

export interface CompositeWeights {
  /** Weight on Sharpe ratio (risk-adjusted return). Default: 0.35. */
  readonly sharpe?: number;
  /** Weight on Sortino ratio (downside-risk-adjusted). Default: 0.25. */
  readonly sortino?: number;
  /** Weight on max drawdown (inverted). Default: 0.20. */
  readonly maxDrawdown?: number;
  /** Weight on total return. Default: 0.10. */
  readonly totalReturn?: number;
  /** Weight on profit factor. Default: 0.10. */
  readonly profitFactor?: number;
}

/**
 * ResearchReportService generates comparison reports across completed experiments.
 *
 * Key invariants:
 *   1. Statistically invalid experiments (p ≥ 0.05) are automatically rejected
 *      unless ReportConfig.filter.includeInvalid is explicitly set to true.
 *   2. Experiments are ranked by a composite score (configurable weights) or
 *      a single metric specified in ReportConfig.rankingMetric.
 *   3. Experiments without a result record are excluded and reported separately.
 *
 * ISOLATION: Read-only — never writes to production systems.
 */
@Injectable()
export class ResearchReportService {
  private readonly context = ResearchReportService.name;

  /** Metrics where a lower value is better (all others: higher = better). */
  private static readonly LOWER_IS_BETTER: ReadonlySet<RankingMetric> = new Set([
    'maxDrawdownPercent',
  ]);

  constructor(
    private readonly storage: ExperimentStorageService,
    private readonly logger: AppLoggerService,
  ) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Generates a research report by loading all completed experiments,
   * applying filters, rejecting statistically invalid results, and
   * ranking survivors by the configured metric or composite score.
   */
  async generateReport(config: ReportConfig = {}): Promise<ResearchReport> {
    const rankingMetric = config.rankingMetric ?? 'sharpeRatio';
    const topN = config.topN ?? 50;
    const includeInvalid = config.filter?.includeInvalid ?? false;

    // Load all experiments from storage
    const allExperiments = await this.storage.listAll(0, 1000);
    const completed = allExperiments.filter((e) => e.status === ExperimentStatus.COMPLETED);

    // Apply optional filters
    const filtered = this.applyFilters(completed, config.filter);

    const ranked: RankedExperiment[] = [];
    const rejected: ComparisonEntry[] = [];
    const missing: string[] = [];

    for (const exp of filtered) {
      const result = await this.storage.findResultById(exp.id);

      if (!result) {
        missing.push(exp.id);
        continue;
      }

      const entry: ComparisonEntry = {
        experimentId: exp.id,
        name: exp.name,
        metrics: result.metrics,
        isStatisticallyValid: result.metrics.isStatisticallyValid,
        promotionStage: exp.promotionStage,
      };

      // Statistical validity gate
      if (!result.metrics.isStatisticallyValid && !includeInvalid) {
        rejected.push(entry);
        continue;
      }

      const score = config.compositeWeights
        ? this.buildCompositeScore(result.metrics, config.compositeWeights)
        : this.extractMetricValue(result.metrics, rankingMetric);

      ranked.push({
        rank: 0, // Assigned after sort
        experiment: exp,
        result,
        score,
        isStatisticallyValid: result.metrics.isStatisticallyValid,
      });
    }

    // Sort by score
    const higherIsBetter =
      config.higherIsBetter ?? !ResearchReportService.LOWER_IS_BETTER.has(rankingMetric);

    ranked.sort((a, b) => (higherIsBetter ? b.score - a.score : a.score - b.score));

    // Assign ranks and enforce topN
    const topRanked = ranked.slice(0, topN).map((entry, idx) => ({
      ...entry,
      rank: idx + 1,
    }));

    // Comparison table — all ranked experiments (not limited to topN)
    const comparisonTable: ComparisonEntry[] = topRanked.map((e) => ({
      experimentId: e.experiment.id,
      name: e.experiment.name,
      metrics: e.result.metrics,
      isStatisticallyValid: e.isStatisticallyValid,
      promotionStage: e.experiment.promotionStage,
    }));

    this.logger.log(
      `Research report: evaluated=${filtered.length}, ` +
        `ranked=${topRanked.length}, ` +
        `statistically_rejected=${rejected.length}, ` +
        `missing_results=${missing.length}`,
      this.context,
    );

    return {
      ranked: topRanked,
      statisticallyRejected: rejected,
      missingResults: missing,
      comparisonTable,
      rankingMetric,
      generatedAt: new Date(),
      totalEvaluated: filtered.length,
      totalRejected: rejected.length,
    };
  }

  /**
   * Compares a specific set of experiments by ID.
   * All listed experiments must have a completed result — missing ones are
   * returned in missingResults rather than throwing.
   */
  async compareExperiments(
    experimentIds: string[],
    config: ReportConfig = {},
  ): Promise<ResearchReport> {
    const rankingMetric = config.rankingMetric ?? 'sharpeRatio';
    const includeInvalid = config.filter?.includeInvalid ?? false;

    const ranked: RankedExperiment[] = [];
    const rejected: ComparisonEntry[] = [];
    const missing: string[] = [];

    for (const id of experimentIds) {
      const exp = await this.storage.findById(id);
      if (!exp) {
        missing.push(id);
        continue;
      }

      const result = await this.storage.findResultById(id);
      if (!result) {
        missing.push(id);
        continue;
      }

      const entry: ComparisonEntry = {
        experimentId: exp.id,
        name: exp.name,
        metrics: result.metrics,
        isStatisticallyValid: result.metrics.isStatisticallyValid,
        promotionStage: exp.promotionStage,
      };

      if (!result.metrics.isStatisticallyValid && !includeInvalid) {
        rejected.push(entry);
        continue;
      }

      const score = config.compositeWeights
        ? this.buildCompositeScore(result.metrics, config.compositeWeights)
        : this.extractMetricValue(result.metrics, rankingMetric);

      ranked.push({
        rank: 0,
        experiment: exp,
        result,
        score,
        isStatisticallyValid: result.metrics.isStatisticallyValid,
      });
    }

    const higherIsBetter =
      config.higherIsBetter ?? !ResearchReportService.LOWER_IS_BETTER.has(rankingMetric);

    ranked.sort((a, b) => (higherIsBetter ? b.score - a.score : a.score - b.score));

    const topRanked = ranked.map((entry, idx) => ({
      ...entry,
      rank: idx + 1,
    }));

    const comparisonTable: ComparisonEntry[] = topRanked.map((e) => ({
      experimentId: e.experiment.id,
      name: e.experiment.name,
      metrics: e.result.metrics,
      isStatisticallyValid: e.isStatisticallyValid,
      promotionStage: e.experiment.promotionStage,
    }));

    return {
      ranked: topRanked,
      statisticallyRejected: rejected,
      missingResults: missing,
      comparisonTable,
      rankingMetric,
      generatedAt: new Date(),
      totalEvaluated: experimentIds.length - missing.length,
      totalRejected: rejected.length,
    };
  }

  /**
   * Returns a formatted plain-text summary of a report, suitable for logging
   * or console output.
   */
  formatSummary(report: ResearchReport): string {
    const lines: string[] = [
      `═══ Research Report ═══`,
      `Generated:    ${report.generatedAt.toISOString()}`,
      `Evaluated:    ${report.totalEvaluated}`,
      `Ranked:       ${report.ranked.length}`,
      `Stat. Rejected: ${report.totalRejected} (p ≥ 0.05)`,
      `Missing Results: ${report.missingResults.length}`,
      `Ranking by:   ${report.rankingMetric}`,
      ``,
      `── Top Experiments ────────────────────────────────────────────────────────`,
      `Rank  Name                             Sharpe  Sortino  MaxDD%  Ret%   p-val`,
      `──────────────────────────────────────────────────────────────────────────`,
    ];

    for (const entry of report.ranked) {
      const m = entry.result.metrics;
      const name = entry.experiment.name.padEnd(32).slice(0, 32);
      lines.push(
        `${String(entry.rank).padStart(4)}  ${name}  ` +
          `${m.sharpeRatio.toFixed(2).padStart(6)}  ` +
          `${m.sortinoRatio.toFixed(2).padStart(7)}  ` +
          `${m.maxDrawdownPercent.toFixed(1).padStart(6)}  ` +
          `${m.totalReturnPercent.toFixed(1).padStart(5)}  ` +
          `${m.pValue.toFixed(3)}`,
      );
    }

    if (report.statisticallyRejected.length > 0) {
      lines.push(``, `── Statistically Rejected (p ≥ 0.05) ────────────────────────────────────`);
      for (const entry of report.statisticallyRejected) {
        lines.push(`  ${entry.name.padEnd(32).slice(0, 32)}  p=${entry.metrics.pValue.toFixed(3)}`);
      }
    }

    return lines.join('\n');
  }

  // ── Scoring ───────────────────────────────────────────────────────────────

  /**
   * Builds a composite score from multiple metrics.
   *
   * Score = w_sharpe × sharpe_norm
   *       + w_sortino × sortino_norm
   *       + w_maxDD × (1 - maxDD_norm)      ← inverted: lower DD is better
   *       + w_return × return_norm
   *       + w_pf × pf_norm
   *
   * Each metric is normalised to [0, 1] using a soft sigmoid-like function so
   * outliers don't dominate.
   */
  private buildCompositeScore(metrics: ExperimentMetrics, w: CompositeWeights): number {
    const ws = w.sharpe ?? 0.35;
    const wso = w.sortino ?? 0.25;
    const wdd = w.maxDrawdown ?? 0.2;
    const wret = w.totalReturn ?? 0.1;
    const wpf = w.profitFactor ?? 0.1;

    // Soft normalisation: tanh maps (-∞,+∞) → (-1,1); shift to (0,1)
    const norm = (v: number, scale: number): number => (Math.tanh(v / scale) + 1) / 2;

    const sharpeSc = norm(metrics.sharpeRatio, 2);
    const sortinoSc = norm(metrics.sortinoRatio, 3);
    const ddSc = 1 - norm(metrics.maxDrawdownPercent, 30); // lower is better
    const retSc = norm(metrics.totalReturnPercent, 50);
    const pfSc = norm(metrics.profitFactor - 1, 1); // 0 at PF=1

    return ws * sharpeSc + wso * sortinoSc + wdd * ddSc + wret * retSc + wpf * pfSc;
  }

  private extractMetricValue(metrics: ExperimentMetrics, key: RankingMetric): number {
    return metrics[key];
  }

  // ── Filtering ─────────────────────────────────────────────────────────────

  private applyFilters(experiments: Experiment[], filter?: ReportFilter): Experiment[] {
    if (!filter) return experiments;

    return experiments.filter((exp) => {
      if (filter.stages && !filter.stages.includes(exp.promotionStage)) {
        return false;
      }
      if (filter.tags && filter.tags.length > 0 && !filter.tags.some((t) => exp.tags.includes(t))) {
        return false;
      }
      if (filter.createdAfterMs && exp.createdAt.getTime() < filter.createdAfterMs) {
        return false;
      }
      if (filter.createdBeforeMs && exp.createdAt.getTime() > filter.createdBeforeMs) {
        return false;
      }
      return true;
    });
  }
}
