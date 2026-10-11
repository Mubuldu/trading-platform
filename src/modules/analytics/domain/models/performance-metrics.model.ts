/**
 * PerformanceMetrics contains all core trade-level performance statistics.
 *
 * Formulas:
 *   netProfit      = sum(netPnl) across all trades
 *   grossProfit    = sum(netPnl) for winning trades
 *   grossLoss      = |sum(netPnl)| for losing trades
 *   averageTrade   = netProfit / totalTrades
 *   medianTrade    = median(netPnl) across all trades
 *   winningPercent = winningTrades / totalTrades
 *   losingPercent  = losingTrades / totalTrades
 *   expectancy     = (winRate × averageWin) - (lossRate × averageLoss)
 *   profitFactor   = grossProfit / grossLoss
 *   recoveryFactor = netProfit / maxDrawdown (absolute)
 *   payoffRatio    = averageWin / averageLoss
 *   riskRewardRatio= 1 / payoffRatio (loss : win)
 */
export interface PerformanceMetrics {
  // Capital
  readonly initialCapital: number;
  readonly finalEquity: number;

  // Profit & Loss
  readonly netProfit: number;
  readonly grossProfit: number;
  readonly grossLoss: number;
  readonly totalReturnPercent: number;
  readonly annualizedReturnPercent: number;

  // Trade averages
  readonly averageTrade: number;
  readonly medianTrade: number;
  readonly largestWin: number;
  readonly largestLoss: number;
  readonly averageWin: number;
  readonly averageLoss: number;

  // Counts
  readonly totalTrades: number;
  readonly winningTrades: number;
  readonly losingTrades: number;
  readonly breakEvenTrades: number;

  // Ratios
  readonly winningPercent: number; // 0–1
  readonly losingPercent: number; // 0–1
  readonly expectancy: number; // expected PnL per trade
  readonly profitFactor: number; // grossProfit / grossLoss
  readonly recoveryFactor: number; // netProfit / maxAbsoluteDrawdown
  readonly payoffRatio: number; // averageWin / averageLoss
  readonly riskRewardRatio: number; // averageLoss / averageWin  (inverted payoff)

  readonly computedAt: number; // unix ms
}
