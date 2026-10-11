import { Injectable } from '@nestjs/common';
import { AnalyticsEquityPoint, AnalyticsTrade } from '../../domain/models/analytics-trade.model';
import { RiskMetricsRecord } from '../../domain/models/risk-metrics.model';
import { BenchmarkDailyReturn } from '../../domain/models/benchmark-comparison.model';

/** Annual risk-free rate (5%). Used for Sharpe and Sortino. */
const RISK_FREE_ANNUAL = 0.05;
const RISK_FREE_DAILY = RISK_FREE_ANNUAL / 252;
const TRADING_DAYS_PER_YEAR = 252;

/**
 * RiskMetricsCalculator computes all risk-adjusted performance statistics.
 *
 * All inputs are plain data; no external I/O is performed.
 *
 * Input requirements:
 *   equityPoints  — chronologically ordered equity curve (one entry per trading day)
 *   trades        — completed round-trip trades (for Treynor beta calculation)
 *   benchmark     — optional; when absent, Treynor and Information ratios return 0
 */
@Injectable()
export class RiskMetricsCalculator {
  compute(
    equityPoints: AnalyticsEquityPoint[],
    _trades: AnalyticsTrade[],
    benchmark?: BenchmarkDailyReturn[],
  ): RiskMetricsRecord {
    const dailyReturns = equityPoints.map((p) => p.dailyReturn);

    const sharpeRatio = this.sharpe(dailyReturns);
    const sortinoRatio = this.sortino(dailyReturns);

    // Drawdown series from equity curve
    const drawdownPercents = this.computeDrawdownSeries(equityPoints);
    const { maxDrawdown, maxDrawdownAbsolute, averageDrawdown } = this.computeDrawdownStats(
      equityPoints,
      drawdownPercents,
    );

    const annualizedReturn = this.annualizedReturn(equityPoints);
    const calmarRatio = maxDrawdown > 0 ? annualizedReturn / (maxDrawdown * 100) : 0;

    const omegaRatio = this.omega(dailyReturns);

    // Rolling ratios (7d, 30d, 90d)
    const rollingSharpe7d = this.rollingRatio(equityPoints, 7, 'sharpe');
    const rollingSharpe30d = this.rollingRatio(equityPoints, 30, 'sharpe');
    const rollingSharpe90d = this.rollingRatio(equityPoints, 90, 'sharpe');
    const rollingSortino7d = this.rollingRatio(equityPoints, 7, 'sortino');
    const rollingSortino30d = this.rollingRatio(equityPoints, 30, 'sortino');
    const rollingSortino90d = this.rollingRatio(equityPoints, 90, 'sortino');

    // Ulcer Index = sqrt(mean of squared drawdown percentages)
    const ulcerIndex = this.ulcerIndex(drawdownPercents);

    // Pain Index = mean of absolute drawdown percentages
    const painIndex =
      drawdownPercents.length > 0
        ? drawdownPercents.reduce((s, d) => s + d, 0) / drawdownPercents.length
        : 0;

    // Benchmark-dependent ratios
    let treynorRatio = 0;
    let informationRatio = 0;

    if (benchmark && benchmark.length > 0) {
      const { treynor, information } = this.benchmarkRatios(
        equityPoints,
        benchmark,
        annualizedReturn,
      );
      treynorRatio = treynor;
      informationRatio = information;
    }

    return {
      sharpeRatio,
      rollingSharpe7d,
      rollingSharpe30d,
      rollingSharpe90d,
      sortinoRatio,
      rollingSortino7d,
      rollingSortino30d,
      rollingSortino90d,
      calmarRatio,
      omegaRatio,
      treynorRatio,
      informationRatio,
      maxDrawdown,
      maxDrawdownAbsolute,
      averageDrawdown,
      ulcerIndex,
      painIndex,
      computedAt: Date.now(),
    };
  }

  // ── Core ratio computations ──────────────────────────────────────────────────

  private sharpe(dailyReturns: number[]): number {
    if (dailyReturns.length < 2) return 0;
    const mean = this.mean(dailyReturns);
    const excessMean = mean - RISK_FREE_DAILY;
    const std = this.std(dailyReturns);
    return std === 0 ? 0 : (excessMean / std) * Math.sqrt(TRADING_DAYS_PER_YEAR);
  }

  private sortino(dailyReturns: number[]): number {
    if (dailyReturns.length < 2) return 0;
    const mean = this.mean(dailyReturns);
    const excessMean = mean - RISK_FREE_DAILY;
    const negReturns = dailyReturns.filter((r) => r < RISK_FREE_DAILY);
    if (negReturns.length === 0) return excessMean > 0 ? Infinity : 0;
    // Semi-deviation calculated relative to MAR = risk-free rate
    const downsideVar =
      dailyReturns.reduce((s, r) => {
        const diff = Math.min(r - RISK_FREE_DAILY, 0);
        return s + diff * diff;
      }, 0) / dailyReturns.length;
    const downsideStd = Math.sqrt(downsideVar);
    return downsideStd === 0 ? 0 : (excessMean / downsideStd) * Math.sqrt(TRADING_DAYS_PER_YEAR);
  }

  private omega(dailyReturns: number[], threshold = 0): number {
    const gains = dailyReturns.reduce((s, r) => s + Math.max(r - threshold, 0), 0);
    const losses = dailyReturns.reduce((s, r) => s + Math.max(threshold - r, 0), 0);
    return losses > 0 ? gains / losses : gains > 0 ? Infinity : 0;
  }

  // ── Drawdown helpers ─────────────────────────────────────────────────────────

  private computeDrawdownSeries(equityPoints: AnalyticsEquityPoint[]): number[] {
    let peak = 0;
    return equityPoints.map((p) => {
      if (p.equity > peak) peak = p.equity;
      return peak > 0 ? (peak - p.equity) / peak : 0;
    });
  }

  private computeDrawdownStats(
    equityPoints: AnalyticsEquityPoint[],
    drawdownPercents: number[],
  ): { maxDrawdown: number; maxDrawdownAbsolute: number; averageDrawdown: number } {
    if (equityPoints.length === 0) {
      return { maxDrawdown: 0, maxDrawdownAbsolute: 0, averageDrawdown: 0 };
    }

    const maxDrawdown = Math.max(...drawdownPercents, 0);
    const avgDrawdown = this.mean(drawdownPercents);

    // Find the equity value at max drawdown point
    const maxIdx = drawdownPercents.indexOf(maxDrawdown);
    const maxDrawdownAbsolute =
      maxIdx >= 0 && maxIdx < equityPoints.length
        ? maxDrawdown * (equityPoints[maxIdx]!.equity / (1 - maxDrawdown))
        : 0;

    return { maxDrawdown, maxDrawdownAbsolute, averageDrawdown: avgDrawdown };
  }

  // ── Rolling window helpers ───────────────────────────────────────────────────

  private rollingRatio(
    equityPoints: AnalyticsEquityPoint[],
    days: number,
    type: 'sharpe' | 'sortino',
  ): number {
    if (equityPoints.length < days) return 0;
    const slice = equityPoints.slice(-days);
    const returns = slice.map((p) => p.dailyReturn);
    return type === 'sharpe' ? this.sharpe(returns) : this.sortino(returns);
  }

  // ── Ulcer Index ──────────────────────────────────────────────────────────────

  private ulcerIndex(drawdownPercents: number[]): number {
    if (drawdownPercents.length === 0) return 0;
    const squaredMean = drawdownPercents.reduce((s, d) => s + d * d, 0) / drawdownPercents.length;
    return Math.sqrt(squaredMean) * 100; // expressed as percentage
  }

  // ── Annualized return ────────────────────────────────────────────────────────

  private annualizedReturn(equityPoints: AnalyticsEquityPoint[]): number {
    if (equityPoints.length < 2) return 0;
    const first = equityPoints[0]!.equity;
    const last = equityPoints[equityPoints.length - 1]!.equity;
    if (first <= 0) return 0;
    const yearsElapsed = equityPoints.length / TRADING_DAYS_PER_YEAR;
    return (Math.pow(last / first, 1 / yearsElapsed) - 1) * 100;
  }

  // ── Benchmark-dependent ratios ───────────────────────────────────────────────

  private benchmarkRatios(
    equityPoints: AnalyticsEquityPoint[],
    benchmark: BenchmarkDailyReturn[],
    annualizedReturn: number,
  ): { treynor: number; information: number } {
    // Align by date
    const portfolioByDate = new Map(equityPoints.map((p) => [p.date, p.dailyReturn]));
    const pairs: Array<{ portfolio: number; bench: number }> = [];

    for (const b of benchmark) {
      const p = portfolioByDate.get(b.date);
      if (p !== undefined) pairs.push({ portfolio: p, bench: b.returnPct });
    }

    if (pairs.length < 2) return { treynor: 0, information: 0 };

    const portfolioReturns = pairs.map((p) => p.portfolio);
    const benchReturns = pairs.map((p) => p.bench);

    // Beta = Cov(p,b) / Var(b)
    const covPB = this.covariance(portfolioReturns, benchReturns);
    const varB = this.variance(benchReturns);
    const beta = varB > 0 ? covPB / varB : 0;

    const treynor = beta !== 0 ? (annualizedReturn / 100 - RISK_FREE_ANNUAL) / beta : 0;

    // Information ratio = (portfolio return - benchmark return) / trackingError
    const differentials = portfolioReturns.map((p, i) => p - benchReturns[i]!);
    const trackingError = this.std(differentials) * Math.sqrt(TRADING_DAYS_PER_YEAR);
    const meanDiff = this.mean(differentials) * TRADING_DAYS_PER_YEAR;
    const informationRatio = trackingError > 0 ? meanDiff / trackingError : 0;

    return { treynor, information: informationRatio };
  }

  // ── Math utilities ───────────────────────────────────────────────────────────

  private mean(values: number[]): number {
    return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;
  }

  private variance(values: number[]): number {
    if (values.length < 2) return 0;
    const m = this.mean(values);
    return values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
  }

  private std(values: number[]): number {
    return Math.sqrt(this.variance(values));
  }

  private covariance(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length < 2) return 0;
    const ma = this.mean(a);
    const mb = this.mean(b);
    return a.reduce((s, v, i) => s + (v - ma) * (b[i]! - mb), 0) / (a.length - 1);
  }
}
