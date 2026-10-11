import { SweepMethod } from '../enums/sweep-method.enum';

/**
 * The four key metrics extracted from each backtest run during a parameter sweep.
 * These are the only outputs needed by the entire parameter-stability analysis pipeline.
 */
export interface SweepMetrics {
  readonly sharpe: number;
  readonly netProfitPercent: number;
  /** Stored as a positive percentage, e.g. 15.4 means 15.4 % drawdown. */
  readonly maxDrawdownPercent: number;
  /** 0–1 fraction. */
  readonly winRate: number;
}

/**
 * One evaluated parameter combination together with its observed performance.
 */
export interface SweepResultEntry {
  readonly params: Record<string, number>;
  readonly metrics: SweepMetrics;
}

/** Metadata attached to a completed sweep run. */
export interface SweepSummary {
  readonly method: SweepMethod;
  readonly totalCombinations: number;
  readonly results: SweepResultEntry[];
  readonly paramNames: string[];
  /** The combination with the highest Sharpe ratio. */
  readonly bestBySharpe: SweepResultEntry;
  /** The combination with the highest net profit. */
  readonly bestByProfit: SweepResultEntry;
}
