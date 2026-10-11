/**
 * StrategyMetricRow — one row in the strategy comparison table.
 */
export interface StrategyMetricRow {
  readonly strategyId: string;
  readonly strategyLabel: string; // display name

  // Return
  readonly netProfit: number;
  readonly totalReturnPercent: number;
  readonly annualizedReturnPercent: number;

  // Risk-adjusted
  readonly sharpeRatio: number;
  readonly sortinoRatio: number;
  readonly calmarRatio: number;

  // Drawdown
  readonly maxDrawdownPercent: number;

  // Trade
  readonly totalTrades: number;
  readonly winRate: number; // fractional
  readonly expectancy: number;
  readonly profitFactor: number;
}

/**
 * StrategyComparisonSection — side-by-side comparison of multiple strategies.
 *
 * Populated only when the report config includes multiple strategyIds.
 * Each field in the "best by" group holds the strategyId of the winner.
 */
export interface StrategyComparisonSection {
  readonly strategies: StrategyMetricRow[];

  // Winners (by metric)
  readonly bestByReturn: string; // strategyId
  readonly bestBySharpe: string;
  readonly bestBySortino: string;
  readonly bestByCalmar: string;
  readonly bestByDrawdown: string; // lowest drawdown
  readonly bestByExpectancy: string;
  readonly bestByProfitFactor: string;
}
