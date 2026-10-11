import { RollingWindow } from '../enums/rolling-window.enum';

/**
 * RollingWindowMetrics contains computed metrics for a specific look-back window.
 * All metrics are calculated using only the data within the window.
 */
export interface RollingWindowMetrics {
  readonly window: RollingWindow; // look-back period in days
  readonly windowDays: number; // same as window value
  readonly startDate: string; // YYYY-MM-DD
  readonly endDate: string; // YYYY-MM-DD

  // Returns
  readonly totalReturnPercent: number;
  readonly annualizedReturnPercent: number;

  // Risk ratios (annualized)
  readonly sharpeRatio: number;
  readonly sortinoRatio: number;
  readonly calmarRatio: number;

  // Drawdown
  readonly maxDrawdown: number; // fractional
  readonly averageDrawdown: number; // fractional

  // Trade stats
  readonly totalTrades: number;
  readonly winRate: number; // fractional
  readonly profitFactor: number;
  readonly netProfit: number;

  // Volatility
  readonly dailyVolatility: number; // std of daily returns
  readonly annualizedVolatility: number; // dailyVolatility × sqrt(252)

  readonly computedAt: number;
}

/**
 * RollingMetrics bundles the metrics for all defined rolling windows.
 */
export interface RollingMetrics {
  readonly sevenDay: RollingWindowMetrics;
  readonly thirtyDay: RollingWindowMetrics;
  readonly ninetyDay: RollingWindowMetrics;
  readonly oneEightyDay: RollingWindowMetrics;
  readonly threeSixtyFiveDay: RollingWindowMetrics;
  readonly computedAt: number;
}
