import { Injectable } from '@nestjs/common';
import { ProbabilisticSharpeResult } from '../domain/models/probabilistic-sharpe-result.model';
import { excessKurtosis, normalCdf, skewness, stdDev, mean } from './stat-utils';

/**
 * ProbabilisticSharpeService
 *
 * Computes the Probabilistic Sharpe Ratio (PSR) as defined by Bailey &
 * Lopez de Prado (2014), "The Sharpe Ratio Efficient Frontier".
 *
 * PSR answers: "Given T observed returns, what is the probability that the
 * true Sharpe ratio exceeds a chosen benchmark SR*?"
 *
 * Standard error of SR_hat (adjusting for non-normality via skewness γ₁ and
 * excess kurtosis γ₂):
 *
 *   SE[SR_hat] = sqrt( (1 − γ₁·SR_hat + (γ₂−1)/4·SR_hat²) / (T−1) )
 *
 * PSR:
 *   PSR(SR*) = Φ( (SR_hat − SR*) / SE[SR_hat] )
 *
 * A PSR > 0.95 is the conventional significance threshold.
 */
@Injectable()
export class ProbabilisticSharpeService {
  private static readonly SIGNIFICANCE_THRESHOLD = 0.95;
  private static readonly MIN_OBSERVATIONS = 3;

  /**
   * Computes PSR from a raw time series of period returns.
   *
   * @param returns  Array of per-period returns (e.g. daily PnL as a fraction,
   *                 NOT annualised — the Sharpe here is the T-period form).
   * @param benchmarkSharpe  SR* to test against (default 0).
   */
  compute(returns: number[], benchmarkSharpe = 0): ProbabilisticSharpeResult {
    const T = returns.length;

    if (T < ProbabilisticSharpeService.MIN_OBSERVATIONS) {
      return this.trivialResult(returns, benchmarkSharpe);
    }

    const μ = mean(returns);
    const σ = stdDev(returns, 1); // sample std (ddof = 1)

    // SR in units of the observation period (un-annualised)
    const observedSharpe = σ > 0 ? μ / σ : 0;
    const γ1 = skewness(returns);
    const γ2 = excessKurtosis(returns);

    const seSquared = (1 - γ1 * observedSharpe + ((γ2 - 1) / 4) * observedSharpe ** 2) / (T - 1);

    // SE can theoretically be negative if the formula's bracketed term is negative
    // (happens for very high SRs with fat tails); clamp to a small positive.
    const standardError = seSquared > 0 ? Math.sqrt(seSquared) : 1 / Math.sqrt(T - 1);

    const zScore = standardError > 0 ? (observedSharpe - benchmarkSharpe) / standardError : 0;

    const psr = normalCdf(zScore);
    const isSignificant = psr >= ProbabilisticSharpeService.SIGNIFICANCE_THRESHOLD;

    return {
      observedSharpe,
      benchmarkSharpe,
      standardError,
      psr,
      isSignificant,
      nObservations: T,
      skewness: γ1,
      excessKurtosis: γ2,
    };
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private trivialResult(returns: number[], benchmarkSharpe: number): ProbabilisticSharpeResult {
    const T = returns.length;
    const γ1 = T >= 3 ? skewness(returns) : 0;
    const γ2 = T >= 4 ? excessKurtosis(returns) : 0;
    return {
      observedSharpe: 0,
      benchmarkSharpe,
      standardError: 0,
      psr: 0.5,
      isSignificant: false,
      nObservations: T,
      skewness: γ1,
      excessKurtosis: γ2,
    };
  }
}
