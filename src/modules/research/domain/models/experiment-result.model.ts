// ─── Core Metrics ─────────────────────────────────────────────────────────────

export interface ExperimentMetrics {
  // Return metrics
  readonly totalReturnPercent: number;
  readonly annualizedReturnPercent: number;
  readonly cagr: number;

  // Risk-adjusted performance
  readonly sharpeRatio: number;
  readonly sortinoRatio: number;
  readonly calmarRatio: number;
  readonly omegaRatio: number;

  // Drawdown
  readonly maxDrawdownPercent: number;
  readonly avgDrawdownPercent: number;
  readonly maxDrawdownDurationDays: number;
  readonly ulcerIndex: number;

  // Trade statistics
  readonly tradeCount: number;
  readonly winRate: number;
  readonly profitFactor: number;
  readonly avgWinPercent: number;
  readonly avgLossPercent: number;
  readonly avgHoldingPeriodBars: number;
  readonly expectancy: number;

  // Volatility
  readonly annualizedVolatility: number;
  readonly downwardVolatility: number;

  // Statistical validity
  /**
   * p-value from a one-tailed Welch t-test on daily returns vs zero.
   * H₀: mean return = 0.  Reject H₀ (consider valid) when p < 0.05.
   */
  readonly pValue: number;
  /** True when pValue < 0.05 (statistically significant positive returns). */
  readonly isStatisticallyValid: boolean;
  /** t-statistic from the return significance test. */
  readonly tStatistic: number;
  /** Degrees of freedom used in the t-test. */
  readonly degreesOfFreedom: number;
}

// ─── Equity Curve ─────────────────────────────────────────────────────────────

export interface EquityPoint {
  readonly timestampMs: number;
  readonly equity: number;
  readonly drawdownPercent: number;
}

// ─── Trade Record ────────────────────────────────────────────────────────────

export interface ExperimentTrade {
  readonly entryTimestampMs: number;
  readonly exitTimestampMs: number;
  readonly direction: 'LONG' | 'SHORT';
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly quantity: number;
  readonly grossPnl: number;
  readonly commission: number;
  readonly slippage: number;
  readonly netPnl: number;
  readonly returnPercent: number;
  readonly holdingPeriodBars: number;
}

// ─── Experiment Result ────────────────────────────────────────────────────────

export interface ExperimentResult {
  readonly experimentId: string;
  readonly metrics: ExperimentMetrics;
  readonly equityCurve: EquityPoint[];
  readonly trades: ExperimentTrade[];
  /** Any model-specific or domain-specific metrics keyed by name. */
  readonly customMetrics: Record<string, number>;
  /**
   * Raw text output from a Python script execution.
   * Stored verbatim for debugging; empty string for native experiments.
   */
  readonly rawOutput: string;
  readonly computedAt: Date;
}
