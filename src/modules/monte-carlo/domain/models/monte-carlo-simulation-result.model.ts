/**
 * Outcome of a single Monte Carlo path (one resampled trade sequence).
 */
export interface MonteCarloSimulationResult {
  /** Zero-based index within the simulation run. */
  readonly simulationIndex: number;

  /** Equity at the end of the path (in the same currency as initialCapital). */
  readonly finalEquity: number;

  /** (finalEquity − initialCapital) / initialCapital × 100. */
  readonly totalReturnPercent: number;

  /** Compounded annual growth rate derived from the backtest window. */
  readonly cagrPercent: number;

  /** Peak-to-trough drawdown percentage recorded along the path. */
  readonly maxDrawdownPercent: number;

  /** Annualised Sharpe ratio (risk-free = 5 % p.a., 252 trading days). */
  readonly sharpeRatio: number;

  /** Annualised Sortino ratio (downside deviation). */
  readonly sortinoRatio: number;

  /** true when equity fell below the configured ruinThresholdPercent. */
  readonly isRuin: boolean;

  /** Number of trades replayed in this simulation (may be < original if ruined). */
  readonly tradeCount: number;

  /**
   * Sampled equity-curve values (max 100 points) for visualisation.
   * Point 0 is always `initialCapital`; the last point is `finalEquity`.
   */
  readonly equityCurve: number[];
}
