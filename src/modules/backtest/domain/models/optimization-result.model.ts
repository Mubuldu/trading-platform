import { StrategyPluginConfig } from '@modules/strategy/interfaces/strategy.interface';
import { OptimizationConfig } from './optimization-config.model';

/**
 * The full set of TrendFollowingV1 parameter values for a single combination.
 * Every field is required — partial combos are not stored.
 */
export interface TfV1ParamCombo {
  emaPeriodFast: number;
  emaPeriodSlow: number;
  adxPeriod: number;
  adxThreshold: number;
  donchianWindow: number;
  atrPeriod: number;
  atrMultiplier: number;
  atrMinThreshold: number;
  volumeMaPeriod: number;
  cooldownCandles: number;
  maxHoldingCandles: number;
  donchianBreakoutTolerancePct: number;
}

/**
 * Condensed performance metrics extracted from a PerformanceReport.
 * Stored for every combo; keeps the result payload manageable vs embedding
 * the full equity curve and trade list for all 54+ combos.
 */
export interface PerformanceSummary {
  readonly totalReturnPercent: number;
  readonly annualizedReturnPercent: number;
  readonly sharpeRatio: number;
  readonly sortinoRatio: number;
  readonly calmarRatio: number;
  readonly maxDrawdownPercent: number;
  readonly totalTrades: number;
  readonly winRate: number;           // 0–1
  readonly profitFactor: number;
  readonly payoffRatio: number;
  readonly averageTradeDurationMs: number;
  readonly totalCommission: number;
}

/** Result of running a single parameter combination on one data period. */
export interface ComboEvaluation {
  /** 0-based index of this combo in the expanded grid. */
  readonly comboIndex: number;
  readonly params: TfV1ParamCombo;

  /** Performance on the train period (always present). */
  readonly trainSummary: PerformanceSummary;
  /** Rank by fitness metric among all train combos (1 = best). */
  readonly trainRank: number;

  /** Performance on the test period (present only for top-N combos). */
  readonly testSummary?: PerformanceSummary;
  /** Rank by fitness metric among test combos (1 = best). Undefined for non-top-N combos. */
  readonly testRank?: number;

  /**
   * True when the combo passes all `thresholds` on the test period.
   * Only meaningful for combos that were validated (testSummary present).
   */
  readonly passesThresholds: boolean;

  /**
   * Overfit signal: true when trainSharpe is substantially higher than testSharpe.
   * Heuristic: trainSharpe > testSharpe × 1.5 and testSharpe < 0.5.
   */
  readonly overfit: boolean;
}

/** Status of a running or completed optimization job (stored in Redis). */
export interface OptimizationJobStatus {
  readonly jobId: string;
  readonly status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  readonly startedAt: number;
  completedAt?: number;
  durationMs?: number;
  progress: {
    phase: 'TRAIN' | 'TEST';
    current: number;
    total: number;
    pct: number;
    currentParams?: TfV1ParamCombo;
  };
  result?: OptimizationResult;
  error?: string;
}

/** Full output of a completed walk-forward optimization run. */
export interface OptimizationResult {
  readonly jobId: string;
  readonly config: OptimizationConfig;

  readonly totalCombinations: number;   // grid size before filtering
  readonly validCombinations: number;   // after constraint filtering (emaPeriodFast < emaPeriodSlow)
  readonly topN: number;

  readonly trainPeriod: { startMs: number; endMs: number };
  readonly testPeriod: { startMs: number; endMs: number };

  /** Best combo by fitness metric on the train period. */
  readonly bestByTrain: ComboEvaluation;
  /** Best combo by fitness metric on the test period (may differ from bestByTrain). */
  readonly bestByTest?: ComboEvaluation;

  /**
   * Ready-to-use StrategyPluginConfig for the best validated combo.
   * Apply this to the live strategy via StrategyRegistryService.reload().
   * Only set when at least one combo passes the acceptance thresholds.
   */
  readonly bestValidatedConfig?: StrategyPluginConfig;

  /**
   * Spearman rank-correlation between train and test Sharpe across the top-N combos.
   * High correlation (≥ 0.7) means the strategy generalises well.
   * Low correlation (< 0.4) is a sign of overfitting — consider a narrower search space.
   */
  readonly trainTestCorrelation?: number;

  /**
   * True when the rank correlation is below 0.4 — the train-period ranking
   * does not predict out-of-sample performance, indicating overfitting.
   */
  readonly isOverfit: boolean;

  /** All combo evaluations ranked by train fitness (trainRank ascending). */
  readonly allTrainEvaluations: ComboEvaluation[];
  /** Top-N combo evaluations with test results included. */
  readonly topNEvaluations: ComboEvaluation[];

  readonly warnings: string[];
}
