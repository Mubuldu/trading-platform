/**
 * RiskMetricsRecord contains all risk-adjusted performance statistics.
 *
 * Annualisation convention: daily returns × sqrt(252) for ratios.
 * Risk-free rate: 5% per annum (configurable via ANALYTICS_RISK_FREE_RATE).
 *
 * Formulas:
 *   sharpeRatio    = (meanDailyReturn - riskFreeDaily) / stdDailyReturn × sqrt(252)
 *   sortinoRatio   = (meanDailyReturn - riskFreeDaily) / downsideStd × sqrt(252)
 *                    where downsideStd = sqrt(mean(min(r,0)²))
 *   calmarRatio    = annualizedReturn / maxDrawdownPercent
 *   omegaRatio     = sum(max(r-threshold,0)) / sum(max(threshold-r,0))
 *                    threshold = 0 (returns above zero vs below zero)
 *   treynorRatio   = (portfolioReturn - riskFree) / beta
 *                    beta computed against benchmark returns
 *   informationRatio = (portfolioReturn - benchmarkReturn) / trackingError
 *                    trackingError = std of (portfolio - benchmark) daily returns
 *   maxDrawdown    = max peak-to-trough decline (fractional, e.g. 0.15 = 15%)
 *   averageDrawdown= mean of all drawdown values at each equity point
 *   ulcerIndex     = sqrt(mean(drawdownPercent²))  — measures pain depth
 *   painIndex      = mean(drawdownPercent)          — measures pain breadth
 */
export interface RiskMetricsRecord {
  // Sharpe family
  readonly sharpeRatio: number;
  readonly rollingSharpe7d: number;
  readonly rollingSharpe30d: number;
  readonly rollingSharpe90d: number;

  // Sortino family
  readonly sortinoRatio: number;
  readonly rollingSortino7d: number;
  readonly rollingSortino30d: number;
  readonly rollingSortino90d: number;

  // Other ratios
  readonly calmarRatio: number;
  readonly omegaRatio: number;
  readonly treynorRatio: number; // NaN when no benchmark available
  readonly informationRatio: number; // NaN when no benchmark available

  // Drawdown
  readonly maxDrawdown: number; // fractional (0.15 = 15%)
  readonly maxDrawdownAbsolute: number; // in quote currency
  readonly averageDrawdown: number; // fractional mean across all points
  readonly ulcerIndex: number;
  readonly painIndex: number;

  readonly computedAt: number;
}
