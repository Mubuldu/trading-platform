/**
 * Result of the Deflated Sharpe Ratio (DSR) test.
 *
 * DSR adjusts the PSR benchmark for multiple testing (data mining bias).
 * When N independent parameter combinations have been tried, the expected
 * maximum Sharpe ratio by chance is:
 *
 *   SR_min ≈ σ_SR · Φ⁻¹(1 − 1/N)
 *
 * where σ_SR is the cross-trial standard deviation of observed Sharpe ratios
 * and Φ⁻¹ is the standard-normal quantile function.
 *
 * DSR = PSR(SR* = SR_min)
 *
 * A DSR < 0.95 means the best observed Sharpe is consistent with pure luck
 * across N trials — a strong signal of data-mining over-fitting.
 *
 * Reference: Bailey & Lopez de Prado (2014), "The Deflated Sharpe Ratio".
 */
export interface DeflatedSharpeResult {
  /** The best observed Sharpe ratio across all tested combinations. */
  readonly observedSharpe: number;
  /** Minimum Sharpe required to beat the expected maximum from N random trials. */
  readonly minRequiredSharpe: number;
  /**
   * DSR: probability that the best observed SR genuinely exceeds the expected
   * maximum from N random trials.  Values < 0.95 indicate likely over-fitting.
   */
  readonly deflatedSharpeRatio: number;
  /** True when deflatedSharpeRatio ≥ 0.95. */
  readonly isSignificant: boolean;
  /** Number of independent parameter combinations tested. */
  readonly nTrials: number;
  /** Number of return observations in the best-trial backtest. */
  readonly nObservations: number;
  /** Cross-trial std of observed Sharpe ratios (used to derive SR_min). */
  readonly trialSharpeStdDev: number;
  /** Sample skewness of the best-trial returns. */
  readonly skewness: number;
  /** Sample excess kurtosis of the best-trial returns. */
  readonly excessKurtosis: number;
}
