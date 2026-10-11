import { Timeframe } from '@modules/indicator/domain/enums/timeframe.enum';
import { BacktestCommissionConfig, BacktestSlippageConfig } from './backtest-config.model';
import { DataSourceType } from '../enums/data-source-type.enum';

/**
 * Grid of TrendFollowingV1 parameter values to sweep.
 *
 * Each key maps to a list of candidate values. Omit a key to pin it at its
 * default. The optimizer performs the Cartesian product of all axes and
 * filters out invalid combinations (e.g. emaPeriodFast >= emaPeriodSlow).
 *
 * Default values (used when a key is omitted):
 *   emaPeriodFast:                 50
 *   emaPeriodSlow:                200
 *   adxPeriod:                     14
 *   adxThreshold:                  25
 *   donchianWindow:                20
 *   atrPeriod:                     14
 *   atrMultiplier:                2.0
 *   atrMinThreshold:                0
 *   volumeMaPeriod:                20
 *   cooldownCandles:                3
 *   maxHoldingCandles:             50
 *   donchianBreakoutTolerancePct: 0.15
 */
export interface TfV1ParameterGrid {
  emaPeriodFast?: number[];
  emaPeriodSlow?: number[];
  adxPeriod?: number[];
  adxThreshold?: number[];
  donchianWindow?: number[];
  atrPeriod?: number[];
  atrMultiplier?: number[];
  atrMinThreshold?: number[];
  volumeMaPeriod?: number[];
  cooldownCandles?: number[];
  maxHoldingCandles?: number[];
  donchianBreakoutTolerancePct?: number[];
}

/** Minimum performance thresholds a validated combo must satisfy. */
export interface AcceptanceThresholds {
  /** Minimum Sharpe ratio on the out-of-sample test period (default: 0.8). */
  minSharpe?: number;
  /** Minimum win rate, 0–100 (default: 45). */
  minWinRate?: number;
  /** Minimum profit factor (default: 1.3). */
  minProfitFactor?: number;
  /** Maximum drawdown in percent (default: 20). */
  maxDrawdownPct?: number;
  /** Minimum number of trades — below this the result is not statistically meaningful (default: 50). */
  minTrades?: number;
}

/**
 * Top-level configuration for a walk-forward parameter optimization run.
 *
 * Walk-forward split:
 *   1. Run ALL parameter combos on [trainStartMs, trainEndMs].
 *   2. Rank by `rankBy` metric.
 *   3. Take the top `topN` combos and validate them on [testStartMs, testEndMs].
 *   4. The best out-of-sample performer (if it passes `thresholds`) is the validated config.
 *
 * Golden rule: Never inspect testStartMs/testEndMs during step 1.
 * The test period must stay completely unseen until the final validation step.
 */
export interface OptimizationConfig {
  // ─── Data source ─────────────────────────────────────────────────────────
  readonly symbol: string;
  readonly exchange: string;
  readonly timeframe: Timeframe;
  readonly dataSource: DataSourceType;

  // ─── Walk-forward split ───────────────────────────────────────────────────
  readonly trainStartMs: number;
  readonly trainEndMs: number;
  readonly testStartMs: number;
  readonly testEndMs: number;

  // ─── Engine settings ─────────────────────────────────────────────────────
  /**
   * Warmup candles before the active trading period begins.
   * If omitted, the optimizer derives it from the grid's maximum slow-EMA period × 1.5,
   * which ensures all indicators are fully warmed up for every combo.
   */
  readonly warmupCandles?: number;
  readonly initialCapitalUsd: number;
  readonly commission: BacktestCommissionConfig;
  readonly slippage: BacktestSlippageConfig;
  readonly enableRiskChecks?: boolean;
  readonly maxPositionSizePercent?: number;
  readonly maxDailyLossPercent?: number;

  // ─── Search space ─────────────────────────────────────────────────────────
  readonly parameterGrid: TfV1ParameterGrid;

  // ─── Selection & ranking ─────────────────────────────────────────────────
  /** Number of train-winners to validate on the test period (default: 3). */
  readonly topN?: number;

  /**
   * Fitness metric used to rank combos on the train period.
   * Using a risk-adjusted metric (Sharpe) rather than raw return is strongly
   * recommended — it prevents the optimizer from selecting lucky high-variance runs.
   * Default: 'sharpeRatio'.
   */
  readonly rankBy?: 'sharpeRatio' | 'calmarRatio' | 'sortinoRatio' | 'profitFactor' | 'totalReturnPercent';

  /** Acceptance thresholds a combo must satisfy on the test period to be "validated". */
  readonly thresholds?: AcceptanceThresholds;
}
