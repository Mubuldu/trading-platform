import { Injectable } from '@nestjs/common';
import {
  DistributionPercentiles,
  RobustnessGrade,
} from '../domain/models/monte-carlo-result.model';

export interface RobustnessAssessment {
  readonly score: number; // 0–100
  readonly grade: RobustnessGrade;
  readonly isFragile: boolean; // true when score < 60
  readonly factors: string[]; // human-readable penalty explanations
}

/**
 * RobustnessScorerService
 *
 * Translates Monte Carlo aggregate statistics into a single 0–100 score and
 * a four-tier grade that summarises how robust a strategy is to randomisation
 * of trade sequence and execution costs.
 *
 * Scoring rubric (penalties are cumulative, score is clamped to [0, 100]):
 *
 *   Ruin probability        0–30 pts
 *   Return spread (95–5 CI) 0–20 pts
 *   Negative median return  0–15 pts
 *   High median max-DD      0–15 pts
 *   Severe tail risk (CVaR) 0–10 pts
 *   Low median Sharpe       0–10 pts
 *
 * Grading:
 *   ROBUST    ≥ 80
 *   MODERATE  ≥ 60
 *   FRAGILE   ≥ 40
 *   DANGEROUS < 40
 */
@Injectable()
export class RobustnessScorerService {
  score(
    probabilityOfRuin: number,
    returnDistribution: DistributionPercentiles,
    drawdownDistribution: DistributionPercentiles,
    sharpeDistribution: DistributionPercentiles,
    var95: number,
    cvar95: number,
  ): RobustnessAssessment {
    let score = 100;
    const factors: string[] = [];

    // ── 1. Ruin probability (max 30 pts) ──────────────────────────────────
    const ruinPct = probabilityOfRuin * 100;
    if (ruinPct >= 50) {
      score -= 30;
      factors.push(`Very high ruin probability: ${ruinPct.toFixed(1)} %`);
    } else if (ruinPct >= 20) {
      score -= 20;
      factors.push(`High ruin probability: ${ruinPct.toFixed(1)} %`);
    } else if (ruinPct >= 10) {
      score -= 12;
      factors.push(`Elevated ruin probability: ${ruinPct.toFixed(1)} %`);
    } else if (ruinPct >= 5) {
      score -= 6;
      factors.push(`Moderate ruin probability: ${ruinPct.toFixed(1)} %`);
    } else if (ruinPct > 0) {
      factors.push(`Low ruin probability: ${ruinPct.toFixed(1)} %`);
    }

    // ── 2. Return confidence-interval spread (max 20 pts) ─────────────────
    const returnSpread = returnDistribution.p95 - returnDistribution.p5;
    if (returnSpread > 200) {
      score -= 20;
      factors.push(`Extremely wide return spread (p5–p95): ${returnSpread.toFixed(0)} %`);
    } else if (returnSpread > 100) {
      score -= 12;
      factors.push(`Very wide return spread (p5–p95): ${returnSpread.toFixed(0)} %`);
    } else if (returnSpread > 50) {
      score -= 6;
      factors.push(`Wide return spread (p5–p95): ${returnSpread.toFixed(0)} %`);
    }

    // ── 3. Negative-return region (max 15 pts) ────────────────────────────
    if (returnDistribution.median <= 0) {
      score -= 15;
      factors.push(`Negative median return: ${returnDistribution.median.toFixed(1)} %`);
    } else if (returnDistribution.p25 <= 0) {
      score -= 7;
      factors.push(`25th-percentile return negative: ${returnDistribution.p25.toFixed(1)} %`);
    }

    // ── 4. Max drawdown magnitude (max 15 pts) ────────────────────────────
    const medDD = drawdownDistribution.median;
    if (medDD > 40) {
      score -= 15;
      factors.push(`Median max-drawdown > 40 %: ${medDD.toFixed(1)} %`);
    } else if (medDD > 25) {
      score -= 8;
      factors.push(`Median max-drawdown > 25 %: ${medDD.toFixed(1)} %`);
    } else if (medDD > 15) {
      score -= 4;
      factors.push(`Median max-drawdown > 15 %: ${medDD.toFixed(1)} %`);
    }

    // ── 5. Tail risk — VaR95 and CVaR95 (max 10 pts) ─────────────────────
    if (cvar95 < -50 || var95 < -40) {
      score -= 10;
      factors.push(
        `Severe tail risk — VaR95: ${var95.toFixed(1)} %, CVaR95: ${cvar95.toFixed(1)} %`,
      );
    } else if (cvar95 < -20 || var95 < -15) {
      score -= 5;
      factors.push(`High tail risk — VaR95: ${var95.toFixed(1)} %, CVaR95: ${cvar95.toFixed(1)} %`);
    }

    // ── 6. Sharpe ratio (max 10 pts) ──────────────────────────────────────
    const medSharpe = sharpeDistribution.median;
    if (medSharpe < 0) {
      score -= 10;
      factors.push(`Negative median Sharpe ratio: ${medSharpe.toFixed(2)}`);
    } else if (medSharpe < 0.5) {
      score -= 5;
      factors.push(`Low median Sharpe ratio: ${medSharpe.toFixed(2)}`);
    }

    score = Math.max(0, Math.min(100, Math.round(score)));

    const grade = this.gradeFromScore(score);

    return {
      score,
      grade,
      isFragile: score < 60,
      factors: factors.length > 0 ? factors : ['No significant risk factors identified'],
    };
  }

  private gradeFromScore(score: number): RobustnessGrade {
    if (score >= 80) return 'ROBUST';
    if (score >= 60) return 'MODERATE';
    if (score >= 40) return 'FRAGILE';
    return 'DANGEROUS';
  }
}
