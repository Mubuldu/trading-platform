import { Injectable } from '@nestjs/common';
import { gradeFromScore } from '../domain/enums/health-grade.enum';
import { HealthDimension, StrategyHealthScore } from '../domain/models/strategy-health-score.model';
import { DeflatedSharpeResult } from '../domain/models/deflated-sharpe-result.model';
import { ProbabilisticSharpeResult } from '../domain/models/probabilistic-sharpe-result.model';
import { ParameterRegionReport } from '../domain/models/parameter-region.model';
import { SensitivityAnalysisReport } from '../domain/models/sensitivity-analysis.model';

/**
 * StrategyHealthScorerService
 *
 * Combines four input signals into a single 0–100 health score and assigns
 * an A+ / A / B / C / D / F grade.
 *
 * Dimension weights:
 *   Stability   (40 %) — how robust the strategy is to parameter changes.
 *   Robustness  (30 %) — statistical significance of the Sharpe ratio.
 *   Consistency (30 %) — absence of fragility signals (cliffs, islands).
 *
 * Grade thresholds:
 *   A+ ≥ 90  |  A ≥ 80  |  B ≥ 70  |  C ≥ 60  |  D ≥ 50  |  F < 50
 *
 * `isOverfit` is true when the composite score < 50 OR any individual
 * dimension scores < 40.
 *
 * Scoring rubric (penalties are cumulative, each dimension is clamped to 0):
 *
 *   Stability (40 pts):
 *     – > 50 % sensitive params          −30 pts
 *     – > 25 % sensitive params          −15 pts
 *     – overall sensitivity > 0.5        −10 pts  (additional)
 *
 *   Robustness (30 pts):
 *     – PSR < 0.50                       −30 pts
 *     – PSR < 0.80                       −20 pts
 *     – PSR < 0.95                       −10 pts
 *     – DSR < 0.50                       −20 pts  (additional)
 *     – DSR < 0.80                       −12 pts  (additional)
 *     – DSR < 0.95                       − 6 pts  (additional)
 *
 *   Consistency (30 pts):
 *     – any cliff detected               −15 pts
 *     – any island detected              −20 pts
 *     – unstable regions > 50 % total   −10 pts
 */
@Injectable()
export class StrategyHealthScorerService {
  score(
    sensitivity: SensitivityAnalysisReport,
    psr: ProbabilisticSharpeResult,
    dsr: DeflatedSharpeResult,
    regions: ParameterRegionReport,
  ): StrategyHealthScore {
    const stability = this.scoreStability(sensitivity);
    const robustness = this.scoreRobustness(psr, dsr);
    const consistency = this.scoreConsistency(regions);

    const numericScore = Math.round(
      0.4 * stability.score + 0.3 * robustness.score + 0.3 * consistency.score,
    );
    const grade = gradeFromScore(numericScore);

    const allPenalties = [
      ...stability.penalties,
      ...robustness.penalties,
      ...consistency.penalties,
    ];

    // Grade C (60–69) or worse is treated as an overfitting indicator;
    // any individual dimension below 40 also flags the strategy regardless.
    const isOverfit =
      numericScore < 60 || stability.score < 40 || robustness.score < 40 || consistency.score < 40;

    return {
      grade,
      numericScore,
      stability,
      robustness,
      consistency,
      topPenalties: allPenalties.slice(0, 5),
      isOverfit,
    };
  }

  // ── Stability ────────────────────────────────────────────────────────────────

  private scoreStability(sensitivity: SensitivityAnalysisReport): HealthDimension {
    let score = 100;
    const penalties: string[] = [];

    const nTotal = Object.keys(sensitivity.curves).length;
    const nSensitive = sensitivity.sensitiveParams.length;
    const sensitivePct = nTotal > 0 ? nSensitive / nTotal : 0;

    if (sensitivePct > 0.5) {
      score -= 30;
      penalties.push(`${(sensitivePct * 100).toFixed(0)} % of parameters are sensitive to changes`);
    } else if (sensitivePct > 0.25) {
      score -= 15;
      penalties.push(
        `${(sensitivePct * 100).toFixed(0)} % of parameters show above-threshold sensitivity`,
      );
    }

    // Average sensitivity across all curves
    const curves = Object.values(sensitivity.curves);
    const avgSensitivity =
      curves.length > 0 ? curves.reduce((sum, c) => sum + c.sensitivity, 0) / curves.length : 0;

    if (avgSensitivity > 0.5) {
      score -= 10;
      penalties.push(`High average parameter sensitivity index: ${avgSensitivity.toFixed(2)}`);
    }

    return { name: 'Stability', score: Math.max(0, score), penalties };
  }

  // ── Robustness ───────────────────────────────────────────────────────────────

  private scoreRobustness(
    psr: ProbabilisticSharpeResult,
    dsr: DeflatedSharpeResult,
  ): HealthDimension {
    let score = 100;
    const penalties: string[] = [];

    // PSR penalties
    if (psr.psr < 0.5) {
      score -= 30;
      penalties.push(`PSR = ${psr.psr.toFixed(2)} — Sharpe ratio is statistically insignificant`);
    } else if (psr.psr < 0.8) {
      score -= 20;
      penalties.push(`PSR = ${psr.psr.toFixed(2)} — Sharpe ratio has weak statistical support`);
    } else if (psr.psr < 0.95) {
      score -= 10;
      penalties.push(
        `PSR = ${psr.psr.toFixed(2)} — Sharpe ratio below 95 % significance threshold`,
      );
    }

    // DSR penalties (additional)
    if (dsr.deflatedSharpeRatio < 0.5) {
      score -= 20;
      penalties.push(
        `DSR = ${dsr.deflatedSharpeRatio.toFixed(2)} — strong data-mining bias (${dsr.nTrials} trials)`,
      );
    } else if (dsr.deflatedSharpeRatio < 0.8) {
      score -= 12;
      penalties.push(
        `DSR = ${dsr.deflatedSharpeRatio.toFixed(2)} — probable data-mining bias (${dsr.nTrials} trials)`,
      );
    } else if (dsr.deflatedSharpeRatio < 0.95) {
      score -= 6;
      penalties.push(
        `DSR = ${dsr.deflatedSharpeRatio.toFixed(2)} — possible data-mining bias (${dsr.nTrials} trials)`,
      );
    }

    return { name: 'Robustness', score: Math.max(0, score), penalties };
  }

  // ── Consistency ──────────────────────────────────────────────────────────────

  private scoreConsistency(regions: ParameterRegionReport): HealthDimension {
    let score = 100;
    const penalties: string[] = [];

    if (regions.islands.length > 0) {
      score -= 20;
      const names = regions.islands.map((r) => r.paramName).join(', ');
      penalties.push(`Island detected in parameters: ${names} — isolated overfit pockets`);
    }

    if (regions.cliffs.length > 0) {
      score -= 15;
      const names = regions.cliffs.map((r) => r.paramName).join(', ');
      penalties.push(`Cliff detected in parameters: ${names} — performance collapses abruptly`);
    }

    const nTotal = regions.regions.length;
    const nUnstable = regions.unstableRegions.length;
    if (nTotal > 0 && nUnstable / nTotal > 0.5) {
      score -= 10;
      penalties.push(
        `${((nUnstable / nTotal) * 100).toFixed(0)} % of parameters are in unstable regions`,
      );
    }

    return { name: 'Consistency', score: Math.max(0, score), penalties };
  }
}
