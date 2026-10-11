import { Injectable } from '@nestjs/common';
import { TradeRecord } from '@modules/backtest/domain/models/trade-record.model';
import { MonteCarloConfig } from '../domain/models/monte-carlo-config.model';
import { MonteCarloSimulationResult } from '../domain/models/monte-carlo-simulation-result.model';

const MS_PER_YEAR = 365.25 * 24 * 3600 * 1_000;
const RISK_FREE_RATE_ANNUAL = 0.05;
const TRADING_DAYS_PER_YEAR = 252;

/**
 * SimulationRunnerService
 *
 * Replays a single (possibly resampled / shuffled) trade sequence on top of
 * `initialCapital` and produces a full performance summary for that path.
 *
 * Position-sizing note:
 *   Trade PnL values are taken as-is from the recorded trades (absolute $).
 *   This is the standard practice for bootstrap Monte Carlo of trading systems
 *   and is equivalent to assuming fixed fractional position sizing at the time
 *   of the original backtest.  Equity-proportional re-scaling would require
 *   storing per-trade capital snapshots which are not part of TradeRecord.
 *
 * Sharpe / Sortino:
 *   Computed from per-trade equity fractional returns (equity[i] / equity[i-1]).
 *   Annualised by sqrt(252) — treated as daily-equivalent observations.
 */
@Injectable()
export class SimulationRunnerService {
  private static readonly MAX_CURVE_POINTS = 100;

  /**
   * Runs one simulation path.
   *
   * @param simulationIndex  0-based index for tracing.
   * @param trades           Trade sequence to replay (may be resampled).
   * @param config           Monte Carlo configuration.
   */
  run(
    simulationIndex: number,
    trades: TradeRecord[],
    config: MonteCarloConfig,
  ): MonteCarloSimulationResult {
    if (trades.length === 0) {
      return this.emptyResult(simulationIndex, config.initialCapital);
    }

    let equity = config.initialCapital;
    let peakEquity = equity;
    let maxDrawdownPct = 0;
    let isRuin = false;

    const equityCurve: number[] = [equity];
    const fractionalReturns: number[] = [];

    for (const trade of trades) {
      const prevEquity = equity;
      equity += trade.netPnl;

      // Cap equity at zero to avoid nonsensical negative equity paths.
      if (equity < 0) equity = 0;

      equityCurve.push(equity);

      if (prevEquity > 0) {
        fractionalReturns.push((equity - prevEquity) / prevEquity);
      }

      if (equity > peakEquity) {
        peakEquity = equity;
      }

      const drawdownPct = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
      if (drawdownPct > maxDrawdownPct) {
        maxDrawdownPct = drawdownPct;
      }

      if (drawdownPct >= config.ruinThresholdPercent) {
        isRuin = true;
        break;
      }
    }

    const totalReturnPercent =
      config.initialCapital > 0
        ? ((equity - config.initialCapital) / config.initialCapital) * 100
        : 0;

    const durationMs = config.endTime - config.startTime;
    const yearsElapsed = durationMs / MS_PER_YEAR;
    const cagrPercent =
      yearsElapsed > 0 && config.initialCapital > 0 && equity > 0
        ? (Math.pow(equity / config.initialCapital, 1 / yearsElapsed) - 1) * 100
        : 0;

    const sharpeRatio = this.computeSharpe(fractionalReturns);
    const sortinoRatio = this.computeSortino(fractionalReturns);

    return {
      simulationIndex,
      finalEquity: equity,
      totalReturnPercent,
      cagrPercent,
      maxDrawdownPercent: maxDrawdownPct,
      sharpeRatio,
      sortinoRatio,
      isRuin,
      tradeCount: equityCurve.length - 1, // actual trades processed (stops at ruin)
      equityCurve: this.sampleCurve(equityCurve),
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private computeSharpe(returns: number[]): number {
    if (returns.length < 2) return 0;

    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const riskFreePerObs = RISK_FREE_RATE_ANNUAL / TRADING_DAYS_PER_YEAR;
    const excessMean = mean - riskFreePerObs;

    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
    const std = Math.sqrt(variance);

    return std > 0 ? (excessMean / std) * Math.sqrt(TRADING_DAYS_PER_YEAR) : 0;
  }

  private computeSortino(returns: number[]): number {
    if (returns.length < 2) return 0;

    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const riskFreePerObs = RISK_FREE_RATE_ANNUAL / TRADING_DAYS_PER_YEAR;
    const excessMean = mean - riskFreePerObs;

    const negReturns = returns.filter((r) => r < 0);
    if (negReturns.length === 0) return excessMean > 0 ? Infinity : 0;

    // Downside deviation uses the full N as denominator (MAR = 0).
    const downsideVariance = negReturns.reduce((s, r) => s + r ** 2, 0) / returns.length;
    const downsideStd = Math.sqrt(downsideVariance);

    return downsideStd > 0 ? (excessMean / downsideStd) * Math.sqrt(TRADING_DAYS_PER_YEAR) : 0;
  }

  /**
   * Down-samples the equity curve to at most MAX_CURVE_POINTS values to keep
   * memory consumption manageable across thousands of simulations.
   * Always preserves the first and last point.
   */
  private sampleCurve(curve: number[]): number[] {
    const max = SimulationRunnerService.MAX_CURVE_POINTS;
    if (curve.length <= max) return curve;

    const step = (curve.length - 1) / (max - 1);
    const result: number[] = new Array(max);
    for (let i = 0; i < max; i++) {
      result[i] = curve[Math.round(i * step)];
    }
    return result;
  }

  private emptyResult(simulationIndex: number, initialCapital: number): MonteCarloSimulationResult {
    return {
      simulationIndex,
      finalEquity: initialCapital,
      totalReturnPercent: 0,
      cagrPercent: 0,
      maxDrawdownPercent: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      isRuin: false,
      tradeCount: 0,
      equityCurve: [initialCapital],
    };
  }
}
