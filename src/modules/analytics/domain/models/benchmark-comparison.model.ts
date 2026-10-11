import { BenchmarkType } from '../enums/benchmark-type.enum';

/**
 * BenchmarkDailyReturn is a single daily return observation for a benchmark.
 * Returns are fractional (e.g. 0.02 = +2%).
 */
export interface BenchmarkDailyReturn {
  readonly date: string; // YYYY-MM-DD
  readonly returnPct: number; // fractional
}

/**
 * BenchmarkComparison holds the comparison of the strategy against one benchmark.
 *
 * alpha        = strategy annualized return - benchmark annualized return
 * beta         = covariance(strategy, benchmark) / variance(benchmark)
 * correlation  = pearson correlation of daily returns (-1 to +1)
 * trackingError= std of (strategy return - benchmark return) daily differences
 * informationRatio = alpha / trackingError
 */
export interface BenchmarkComparison {
  readonly benchmarkType: BenchmarkType;
  readonly benchmarkLabel: string;

  // Returns over compared period
  readonly benchmarkTotalReturnPercent: number;
  readonly strategyTotalReturnPercent: number;

  // Risk-adjusted comparison
  readonly alpha: number; // excess annualized return over benchmark
  readonly beta: number; // sensitivity to benchmark moves
  readonly correlation: number; // Pearson correlation of daily returns
  readonly trackingError: number; // std of return differential
  readonly informationRatio: number; // alpha / trackingError

  // Sharpe comparison
  readonly benchmarkSharpe: number;
  readonly strategySharpe: number;

  // Win rate vs benchmark (days strategy outperformed)
  readonly outperformanceDays: number;
  readonly underperformanceDays: number;
  readonly outperformanceRate: number; // fractional

  readonly periodStartDate: string;
  readonly periodEndDate: string;
  readonly computedAt: number;
}
