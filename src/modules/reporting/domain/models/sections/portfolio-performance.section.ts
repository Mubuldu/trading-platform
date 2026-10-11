/**
 * PortfolioPerformanceSection — full capital and return attribution breakdown.
 */
export interface PortfolioPerformanceSection {
  // Capital
  readonly initialCapital: number;
  readonly finalEquity: number;
  readonly currentBalance: number;
  readonly buyingPower: number;

  // Absolute PnL
  readonly netProfit: number;
  readonly grossProfit: number;
  readonly grossLoss: number;
  readonly realizedPnl: number;
  readonly unrealizedPnl: number;
  readonly totalCommissions: number;

  // Returns
  readonly totalReturnPercent: number;
  readonly annualizedReturnPercent: number;

  // Equity curve statistics
  readonly averageEquity: number;
  readonly peakEquity: number;
  readonly peakEquityDate: string; // YYYY-MM-DD
  readonly troughEquity: number;
  readonly troughEquityDate: string; // YYYY-MM-DD

  // Leverage
  readonly leverageUtilization: number;
  readonly marginUtilizationPercent: number;
  readonly cashUtilizationPercent: number;

  // Return ratios
  readonly profitFactor: number;
  readonly recoveryFactor: number;
  readonly payoffRatio: number;
}
