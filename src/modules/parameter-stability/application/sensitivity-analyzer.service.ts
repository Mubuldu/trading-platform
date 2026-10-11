import { Injectable } from '@nestjs/common';
import {
  SensitivityAnalysisReport,
  SensitivityCurve,
  SensitivityPoint,
} from '../domain/models/sensitivity-analysis.model';
import { SweepResultEntry } from '../domain/models/sweep-result.model';
import { mean, stdDev } from './stat-utils';

/**
 * SensitivityAnalyzerService
 *
 * Builds a marginal sensitivity curve for every parameter in a completed
 * parameter sweep.
 *
 * Algorithm (One Factor at a Time — marginal averaging):
 *   For each parameter P:
 *     1. Group all sweep results by the concrete value of P.
 *     2. Within each group, compute the mean and std of the target metric.
 *     3. Report how much the mean metric changes as P varies across its range.
 *
 * The "sensitivity index" is:
 *   S = (max_mean − min_mean) / max(|baseline|, ε)
 *
 * S > 0.5 means the metric swings by more than 50 % of the baseline value —
 * a conservative but practical threshold for flagging a parameter as sensitive.
 *
 * Metric used: Sharpe ratio (most informative single metric for risk-adjusted
 * performance).
 */
@Injectable()
export class SensitivityAnalyzerService {
  private static readonly SENSITIVITY_THRESHOLD = 0.5;
  private static readonly EPSILON = 1e-10;

  analyze(results: SweepResultEntry[]): SensitivityAnalysisReport {
    if (results.length === 0) {
      return { curves: {}, sensitiveParams: [], overallRobustness: 1 };
    }

    const paramNames = Object.keys(results[0].params);
    const curves: Record<string, SensitivityCurve> = {};

    for (const paramName of paramNames) {
      curves[paramName] = this.buildCurve(paramName, results);
    }

    const curveList = Object.values(curves);
    const sensitiveParams = curveList.filter((c) => c.isSensitive).map((c) => c.paramName);

    const overallRobustness =
      curveList.length > 0 ? (curveList.length - sensitiveParams.length) / curveList.length : 1;

    return { curves, sensitiveParams, overallRobustness };
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private buildCurve(paramName: string, results: SweepResultEntry[]): SensitivityCurve {
    // Group results by the value of this parameter
    const groups = new Map<number, number[]>();
    for (const r of results) {
      const val = r.params[paramName];
      if (val === undefined) continue;
      const bucket = groups.get(val) ?? [];
      bucket.push(r.metrics.sharpe);
      groups.set(val, bucket);
    }

    // Build sorted sensitivity points
    const points: SensitivityPoint[] = Array.from(groups.entries())
      .sort(([a], [b]) => a - b)
      .map(([paramValue, sharpes]) => ({
        paramValue,
        meanMetric: mean(sharpes),
        stdMetric: stdDev(sharpes),
        count: sharpes.length,
      }));

    const means = points.map((p) => p.meanMetric);
    const baselineMetric = this.medianOf(means);
    const maxMean = Math.max(...means);
    const minMean = Math.min(...means);
    const swing = maxMean - minMean;
    const denom = Math.max(Math.abs(baselineMetric), SensitivityAnalyzerService.EPSILON);
    const sensitivity = swing / denom;
    const isSensitive = sensitivity > SensitivityAnalyzerService.SENSITIVITY_THRESHOLD;

    return { paramName, baselineMetric, points, sensitivity, isSensitive };
  }

  private medianOf(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }
}
