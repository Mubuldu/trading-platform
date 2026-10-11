/**
 * RiskMetricsSection — full risk-adjusted performance and volatility statistics.
 */
export interface RiskMetricsSection {
  // Core ratios
  readonly sharpeRatio: number;
  readonly sortinoRatio: number;
  readonly calmarRatio: number;
  readonly omegaRatio: number;
  readonly treynorRatio: number; // NaN when no benchmark available
  readonly informationRatio: number; // NaN when no benchmark available

  // Drawdown
  readonly maxDrawdown: number; // fractional
  readonly maxDrawdownPercent: number;
  readonly maxDrawdownAbsolute: number; // quote currency
  readonly averageDrawdown: number; // fractional
  readonly ulcerIndex: number;
  readonly painIndex: number;

  // Rolling Sharpe
  readonly rolling7dSharpe: number;
  readonly rolling30dSharpe: number;
  readonly rolling90dSharpe: number;

  // Rolling Sortino
  readonly rolling7dSortino: number;
  readonly rolling30dSortino: number;
  readonly rolling90dSortino: number;

  // Rolling returns
  readonly rolling7dReturnPercent: number;
  readonly rolling30dReturnPercent: number;
  readonly rolling90dReturnPercent: number;
  readonly rolling180dReturnPercent: number;
  readonly rolling365dReturnPercent: number;

  // Volatility
  readonly daily7dVolatility: number;
  readonly daily30dVolatility: number;
  readonly annualizedVolatility: number;
}
