import { Injectable } from '@nestjs/common';
import { AnalyticsEquityPoint } from '../../domain/models/analytics-trade.model';
import {
  BenchmarkComparison,
  BenchmarkDailyReturn,
} from '../../domain/models/benchmark-comparison.model';
import { BenchmarkType } from '../../domain/enums/benchmark-type.enum';

const RISK_FREE_DAILY = 0.05 / 252;
const TRADING_DAYS_PER_YEAR = 252;

/**
 * BenchmarkCalculator compares portfolio returns against an external benchmark.
 *
 * The benchmark daily return series must be aligned to calendar dates (YYYY-MM-DD).
 * Days that exist in one series but not the other are excluded from the comparison.
 *
 * Supported benchmark types:
 *   BUY_AND_HOLD — the portfolio's own capital deployed at start and held flat
 *   BTC / ETH / SP500 / CUSTOM — require external daily return data injected by caller
 *
 * For BUY_AND_HOLD the benchmark return series is constructed internally from
 * the equity points, representing a single buy at t=0 and hold to t=last.
 */
@Injectable()
export class BenchmarkCalculator {
  compare(
    portfolioPoints: AnalyticsEquityPoint[],
    benchmarkType: BenchmarkType,
    benchmarkLabel: string,
    benchmarkReturns: BenchmarkDailyReturn[],
  ): BenchmarkComparison {
    const portfolioReturns: BenchmarkDailyReturn[] =
      benchmarkType === BenchmarkType.BUY_AND_HOLD
        ? this.buildBuyAndHoldReturns(portfolioPoints)
        : portfolioPoints.map((p) => ({ date: p.date, returnPct: p.dailyReturn }));

    const aligned = this.align(portfolioReturns, benchmarkReturns);
    if (aligned.length === 0) {
      return this.emptyComparison(benchmarkType, benchmarkLabel, portfolioPoints);
    }

    const pReturns = aligned.map((a) => a.portfolio);
    const bReturns = aligned.map((a) => a.bench);

    const strategyTotalReturn = this.totalReturn(pReturns);
    const benchmarkTotalReturn = this.totalReturn(bReturns);

    const strategyAnnualized = this.annualizedReturn(pReturns);
    const benchmarkAnnualized = this.annualizedReturn(bReturns);
    const alpha = strategyAnnualized - benchmarkAnnualized;

    const beta = this.beta(pReturns, bReturns);
    const correlation = this.pearson(pReturns, bReturns);

    // Tracking error = annualized std of daily return differential
    const differentials = pReturns.map((p, i) => p - bReturns[i]!);
    const trackingError = this.std(differentials) * Math.sqrt(TRADING_DAYS_PER_YEAR);
    const informationRatio = trackingError > 0 ? alpha / 100 / trackingError : 0;

    const strategySharpe = this.sharpe(pReturns);
    const benchmarkSharpe = this.sharpe(bReturns);

    const outperformanceDays = differentials.filter((d) => d > 0).length;
    const underperformanceDays = differentials.filter((d) => d < 0).length;
    const outperformanceRate = aligned.length > 0 ? outperformanceDays / aligned.length : 0;

    const periodStartDate = aligned[0]?.date ?? '';
    const periodEndDate = aligned[aligned.length - 1]?.date ?? '';

    return {
      benchmarkType,
      benchmarkLabel,
      benchmarkTotalReturnPercent: benchmarkTotalReturn,
      strategyTotalReturnPercent: strategyTotalReturn,
      alpha,
      beta,
      correlation,
      trackingError,
      informationRatio,
      benchmarkSharpe,
      strategySharpe,
      outperformanceDays,
      underperformanceDays,
      outperformanceRate,
      periodStartDate,
      periodEndDate,
      computedAt: Date.now(),
    };
  }

  // ── Buy-and-Hold benchmark construction ──────────────────────────────────────

  private buildBuyAndHoldReturns(portfolioPoints: AnalyticsEquityPoint[]): BenchmarkDailyReturn[] {
    if (portfolioPoints.length < 2) return [];
    // Buy-and-hold: flat return every day = the portfolio's own daily return
    // This represents holding the same portfolio without trading.
    // For a "no-trade" baseline, we replicate the portfolio's return
    // by treating every day as a hold of the opening equity.
    const first = portfolioPoints[0]!.equity;
    return portfolioPoints.map((p) => ({
      date: p.date,
      returnPct: first > 0 ? (p.equity - first) / first : 0,
    }));
  }

  // ── Alignment ────────────────────────────────────────────────────────────────

  private align(
    portfolio: BenchmarkDailyReturn[],
    benchmark: BenchmarkDailyReturn[],
  ): Array<{ date: string; portfolio: number; bench: number }> {
    const benchMap = new Map(benchmark.map((b) => [b.date, b.returnPct]));
    return portfolio
      .filter((p) => benchMap.has(p.date))
      .map((p) => ({ date: p.date, portfolio: p.returnPct, bench: benchMap.get(p.date)! }));
  }

  // ── Stats helpers ────────────────────────────────────────────────────────────

  private totalReturn(dailyReturns: number[]): number {
    // Compound daily returns: product of (1 + r) - 1
    const compound = dailyReturns.reduce((prod, r) => prod * (1 + r), 1) - 1;
    return compound * 100;
  }

  private annualizedReturn(dailyReturns: number[]): number {
    if (dailyReturns.length < 2) return 0;
    const compound = dailyReturns.reduce((p, r) => p * (1 + r), 1);
    const yearsElapsed = dailyReturns.length / TRADING_DAYS_PER_YEAR;
    return (Math.pow(compound, 1 / yearsElapsed) - 1) * 100;
  }

  private sharpe(dailyReturns: number[]): number {
    if (dailyReturns.length < 2) return 0;
    const m = this.mean(dailyReturns);
    const excessMean = m - RISK_FREE_DAILY;
    const s = this.std(dailyReturns);
    return s === 0 ? 0 : (excessMean / s) * Math.sqrt(TRADING_DAYS_PER_YEAR);
  }

  private beta(portfolio: number[], benchmark: number[]): number {
    const cov = this.covariance(portfolio, benchmark);
    const varB = this.variance(benchmark);
    return varB > 0 ? cov / varB : 0;
  }

  private pearson(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length < 2) return 0;
    const ma = this.mean(a);
    const mb = this.mean(b);
    const num = a.reduce((s, v, i) => s + (v - ma) * (b[i]! - mb), 0);
    const da = Math.sqrt(a.reduce((s, v) => s + (v - ma) ** 2, 0));
    const db = Math.sqrt(b.reduce((s, v) => s + (v - mb) ** 2, 0));
    return da > 0 && db > 0 ? num / (da * db) : 0;
  }

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

  private emptyComparison(
    benchmarkType: BenchmarkType,
    benchmarkLabel: string,
    portfolioPoints: AnalyticsEquityPoint[],
  ): BenchmarkComparison {
    const strategyTotalReturn =
      portfolioPoints.length >= 2
        ? ((portfolioPoints[portfolioPoints.length - 1]!.equity - portfolioPoints[0]!.equity) /
            portfolioPoints[0]!.equity) *
          100
        : 0;

    return {
      benchmarkType,
      benchmarkLabel,
      benchmarkTotalReturnPercent: 0,
      strategyTotalReturnPercent: strategyTotalReturn,
      alpha: 0,
      beta: 0,
      correlation: 0,
      trackingError: 0,
      informationRatio: 0,
      benchmarkSharpe: 0,
      strategySharpe: 0,
      outperformanceDays: 0,
      underperformanceDays: 0,
      outperformanceRate: 0,
      periodStartDate: portfolioPoints[0]?.date ?? '',
      periodEndDate: portfolioPoints[portfolioPoints.length - 1]?.date ?? '',
      computedAt: Date.now(),
    };
  }
}
