import { Injectable } from '@nestjs/common';
import { MonteCarloSimulationResult } from '../domain/models/monte-carlo-simulation-result.model';
import { DistributionPercentiles, HistogramBin } from '../domain/models/monte-carlo-result.model';

const DEFAULT_HISTOGRAM_BINS = 50;

/**
 * StatisticsAggregatorService
 *
 * Transforms a collection of individual simulation results into aggregate
 * statistical outputs: percentile distributions, tail-risk metrics (VaR /
 * CVaR), Ulcer Index, recovery-time estimates, and frequency histograms for
 * visualisation.
 *
 * All methods are pure functions of their arguments — no internal state —
 * so the service is safe to call concurrently.
 */
@Injectable()
export class StatisticsAggregatorService {
  // ── Distribution percentiles ─────────────────────────────────────────────

  /**
   * Computes p5, p25, median, p75, p95, mean, and standard deviation of
   * an arbitrary numeric series.  `values` need not be pre-sorted.
   */
  computePercentiles(values: number[]): DistributionPercentiles {
    if (values.length === 0) {
      return { p5: 0, p25: 0, median: 0, p75: 0, p95: 0, mean: 0, stdDev: 0 };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;

    return {
      p5: this.interpolatedPercentile(sorted, 5),
      p25: this.interpolatedPercentile(sorted, 25),
      median: this.interpolatedPercentile(sorted, 50),
      p75: this.interpolatedPercentile(sorted, 75),
      p95: this.interpolatedPercentile(sorted, 95),
      mean,
      stdDev: Math.sqrt(variance),
    };
  }

  /**
   * Returns a specific percentile from a pre-sorted array.
   * Uses linear interpolation between adjacent ranks.
   */
  interpolatedPercentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    if (sorted.length === 1) return sorted[0];

    const idx = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);

    if (lower === upper) return sorted[lower];

    const frac = idx - lower;
    return sorted[lower] * (1 - frac) + sorted[upper] * frac;
  }

  // ── Tail-risk metrics ────────────────────────────────────────────────────

  /**
   * Value at Risk at 95 % confidence — the 5th-percentile total return.
   * Expects a pre-sorted (ascending) returns array for performance.
   */
  computeVar95(sortedReturns: number[]): number {
    return this.interpolatedPercentile(sortedReturns, 5);
  }

  /**
   * Conditional VaR (Expected Shortfall) at 95 % confidence.
   * Mean of returns that are ≤ VaR95.
   * Expects a pre-sorted (ascending) returns array.
   */
  computeCvar95(sortedReturns: number[]): number {
    const var95 = this.computeVar95(sortedReturns);
    const tailReturns = sortedReturns.filter((r) => r <= var95);
    if (tailReturns.length === 0) return var95;
    return tailReturns.reduce((s, r) => s + r, 0) / tailReturns.length;
  }

  /**
   * Ulcer Index — sqrt(mean(percentDrawdown²)) over an equity curve.
   *
   * Captures both depth and duration of drawdowns in a single number.
   * Higher is worse.  Computed on the median simulation path.
   */
  computeUlcerIndex(equityCurve: number[]): number {
    if (equityCurve.length < 2) return 0;

    let peak = equityCurve[0];
    let sumSquared = 0;

    for (const equity of equityCurve) {
      if (equity > peak) peak = equity;
      const ddPct = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
      sumSquared += ddPct * ddPct;
    }

    return Math.sqrt(sumSquared / equityCurve.length);
  }

  // ── Recovery time ────────────────────────────────────────────────────────

  /**
   * Mean number of trades required to recover from a drawdown, averaged
   * across all simulation paths that experienced at least one drawdown.
   *
   * Uses the equity curve index (trade count) as the time unit, which is
   * independent of calendar duration.
   */
  computeAverageRecoveryTime(simulations: MonteCarloSimulationResult[]): number {
    const recoveryTimes: number[] = [];

    for (const sim of simulations) {
      const t = this.pathRecoveryTime(sim.equityCurve);
      if (t !== null) recoveryTimes.push(t);
    }

    return recoveryTimes.length > 0
      ? recoveryTimes.reduce((s, t) => s + t, 0) / recoveryTimes.length
      : 0;
  }

  // ── Histograms ───────────────────────────────────────────────────────────

  /**
   * Builds a frequency histogram with `bins` equal-width buckets.
   * Returns an empty array when the input is empty.
   */
  buildHistogram(values: number[], bins = DEFAULT_HISTOGRAM_BINS): HistogramBin[] {
    if (values.length === 0) return [];

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;

    if (range === 0) {
      return [{ lowerBound: min, upperBound: max, count: values.length, frequency: 1 }];
    }

    const binWidth = range / bins;
    const counts = new Array<number>(bins).fill(0);

    for (const v of values) {
      const idx = Math.min(Math.floor((v - min) / binWidth), bins - 1);
      counts[idx]++;
    }

    return counts.map((count, i) => ({
      lowerBound: min + i * binWidth,
      upperBound: min + (i + 1) * binWidth,
      count,
      frequency: count / values.length,
    }));
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Computes the mean number of steps to fully recover from each drawdown
   * period encountered in a single path.  Returns null if the path never
   * entered a drawdown.
   */
  private pathRecoveryTime(equityCurve: number[]): number | null {
    if (equityCurve.length < 2) return null;

    let peak = equityCurve[0];
    let inDrawdown = false;
    let drawdownStartIdx = 0;
    let totalRecoverySteps = 0;
    let recoveryCount = 0;

    for (let i = 1; i < equityCurve.length; i++) {
      const equity = equityCurve[i];

      if (equity >= peak) {
        if (inDrawdown) {
          totalRecoverySteps += i - drawdownStartIdx;
          recoveryCount++;
          inDrawdown = false;
        }
        peak = equity;
      } else if (!inDrawdown) {
        inDrawdown = true;
        drawdownStartIdx = i;
      }
    }

    return recoveryCount > 0 ? totalRecoverySteps / recoveryCount : null;
  }
}
