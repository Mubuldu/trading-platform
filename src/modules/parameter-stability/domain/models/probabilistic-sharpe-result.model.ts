/**
 * Result of the Probabilistic Sharpe Ratio (PSR) test.
 *
 * PSR answers: "Given T observed returns with estimated Sharpe SR_hat,
 * skewness γ₁, and excess kurtosis γ₂, what is the probability that the
 * true Sharpe exceeds the benchmark SR*?"
 *
 * Formula (Bailey & Lopez de Prado, 2014):
 *   SE[SR_hat] = sqrt((1 - γ₁·SR_hat + (γ₂−1)/4·SR_hat²) / (T−1))
 *   PSR(SR*)   = Φ((SR_hat − SR*) / SE[SR_hat])
 *
 * A PSR > 0.95 is typically required to consider a Sharpe ratio statistically
 * significant at the 5 % level.
 */
export interface ProbabilisticSharpeResult {
  /** Estimated Sharpe ratio from the observed return series. */
  readonly observedSharpe: number;
  /** Benchmark SR against which significance is tested (default 0). */
  readonly benchmarkSharpe: number;
  /** Standard error of the estimated Sharpe ratio. */
  readonly standardError: number;
  /** PSR: probability that the true SR exceeds the benchmark. */
  readonly psr: number;
  /** True when psr > 0.95. */
  readonly isSignificant: boolean;
  /** Number of return observations used. */
  readonly nObservations: number;
  /** Sample skewness of returns (bias-corrected Fisher g₁). */
  readonly skewness: number;
  /** Sample excess kurtosis of returns (bias-corrected Fisher g₂). */
  readonly excessKurtosis: number;
}
