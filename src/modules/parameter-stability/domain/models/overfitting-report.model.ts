import { DeflatedSharpeResult } from './deflated-sharpe-result.model';
import { HeatmapSet } from './heatmap.model';
import { ParameterRegionReport } from './parameter-region.model';
import { ProbabilisticSharpeResult } from './probabilistic-sharpe-result.model';
import { SensitivityAnalysisReport } from './sensitivity-analysis.model';
import { StrategyHealthScore } from './strategy-health-score.model';

/**
 * Master overfitting-detection report produced by OverfittingDetectorService.
 *
 * The `isOverfit` flag is set when two or more of the following are true:
 *   1. DSR < 0.95   (best Sharpe consistent with data-mining luck)
 *   2. PSR < 0.95   (Sharpe statistically insignificant vs. zero benchmark)
 *   3. Fragility signals detected (cliffs or islands in parameter space)
 *   4. Health grade is D or F
 *   5. > 50 % of parameters are sensitive (isSensitive)
 */
export interface OverfittingReport {
  readonly isOverfit: boolean;
  /**
   * Number of overfitting signals (0–5) that fired.
   * 0 = clean, 3+ = strong over-fit evidence.
   */
  readonly signalCount: number;
  readonly healthScore: StrategyHealthScore;
  readonly deflatedSharpe: DeflatedSharpeResult;
  readonly probabilisticSharpe: ProbabilisticSharpeResult;
  readonly sensitivityAnalysis: SensitivityAnalysisReport;
  /** One HeatmapSet per unique parameter pair; empty when < 2 params. */
  readonly heatmapSets: HeatmapSet[];
  readonly parameterRegions: ParameterRegionReport;
  /** Short, actionable warnings (e.g. "Parameter 'period' has a cliff at 25"). */
  readonly warnings: string[];
  /** Actionable recommendations to improve robustness. */
  readonly recommendations: string[];
}
