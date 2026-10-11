import { Injectable } from '@nestjs/common';
import { DeflatedSharpeResult } from '../domain/models/deflated-sharpe-result.model';
import { ProbabilisticSharpeResult } from '../domain/models/probabilistic-sharpe-result.model';
import { ProbabilisticSharpeService } from './probabilistic-sharpe.service';
import { excessKurtosis, normalInvCdf, skewness, stdDev } from './stat-utils';

/**
 * DeflatedSharpeService
 *
 * Implements the Deflated Sharpe Ratio (DSR) test from Bailey & Lopez de Prado
 * (2014), "The Deflated Sharpe Ratio: Correcting for Selection Bias, Backtest
 * Overfitting and Non-Normality".
 *
 * Rationale:
 *   When N parameter combinations (or strategies) are trialled, the best
 *   observed Sharpe is inflated by selection bias even if every combination
 *   performs at chance level.  DSR asks: "Does the best observed SR exceed
 *   what we would expect from pure data mining?"
 *
 * The expected maximum SR from N i.i.d. trials with observed cross-trial
 * standard deviation σ_SR is:
 *
 *   SR_min ≈ σ_SR · Φ⁻¹(1 − 1/N)
 *
 * DSR is then computed as PSR(SR* = SR_min) — the probability that the best
 * observed SR genuinely exceeds this luck-adjusted benchmark.
 *
 * Interpretation:
 *   DSR ≥ 0.95 → the best SR is statistically significant even after
 *                correcting for the number of trials.  Low over-fit risk.
 *   DSR < 0.95 → the best SR is consistent with data-mining luck.  High
 *                over-fit risk — strong evidence of over-optimisation.
 */
@Injectable()
export class DeflatedSharpeService {
  constructor(private readonly psrService: ProbabilisticSharpeService) {}

  /**
   * @param bestReturns    Return series of the best-performing combination.
   * @param allSweepSharpes  Sharpe ratios of ALL tested combinations (including
   *                         the best).  Used to estimate σ_SR across trials.
   */
  compute(bestReturns: number[], allSweepSharpes: number[]): DeflatedSharpeResult {
    const T = bestReturns.length;
    const N = allSweepSharpes.length;

    const γ1 = T >= 3 ? skewness(bestReturns) : 0;
    const γ2 = T >= 4 ? excessKurtosis(bestReturns) : 0;

    // PSR of the best returns against benchmark = 0
    const psrResult: ProbabilisticSharpeResult = this.psrService.compute(bestReturns, 0);
    const observedSharpe = psrResult.observedSharpe;

    // Cross-trial standard deviation of Sharpe ratios
    const trialSharpeStdDev = N >= 2 ? stdDev(allSweepSharpes, 1) : 0;

    // Minimum Sharpe that should beat the expected luck maximum
    // SR_min = σ_SR · Φ⁻¹(1 − 1/N)
    const minRequiredSharpe = N <= 1 ? 0 : trialSharpeStdDev * normalInvCdf(1 - 1 / N);

    // DSR = PSR(SR* = SR_min) using the best-trial returns
    const dsrPsr = this.psrService.compute(bestReturns, minRequiredSharpe);
    const deflatedSharpeRatio = dsrPsr.psr;
    const isSignificant = deflatedSharpeRatio >= 0.95;

    return {
      observedSharpe,
      minRequiredSharpe,
      deflatedSharpeRatio,
      isSignificant,
      nTrials: N,
      nObservations: T,
      trialSharpeStdDev,
      skewness: γ1,
      excessKurtosis: γ2,
    };
  }
}
