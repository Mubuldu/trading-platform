/**
 * TradeSummarySection — trade-level statistics across the report period.
 */
export interface TradeSummarySection {
  // Counts
  readonly totalTrades: number;
  readonly winningTrades: number;
  readonly losingTrades: number;
  readonly breakEvenTrades: number;

  // Rates (fractional)
  readonly winRate: number;
  readonly lossRate: number;

  // PnL per trade
  readonly averageTrade: number;
  readonly medianTrade: number;
  readonly largestWin: number;
  readonly largestLoss: number;
  readonly averageWin: number;
  readonly averageLoss: number;

  // Ratios
  readonly profitFactor: number;
  readonly expectancy: number;
  readonly payoffRatio: number; // averageWin / averageLoss
  readonly riskRewardRatio: number; // averageLoss / averageWin

  // Streaks
  readonly maxConsecutiveWins: number;
  readonly maxConsecutiveLosses: number;

  // Timing
  readonly averageHoldingTimeMs: number;
  readonly averageHoldingTimeFormatted: string; // e.g. "2h 15m"
  readonly maxHoldingTimeMs: number;
  readonly minHoldingTimeMs: number;
  readonly tradeFrequencyPerDay: number;
  readonly tradeFrequencyPerWeek: number;
  readonly longestFlatPeriodMs: number;
  readonly longestFlatPeriodFormatted: string;

  // Period span
  readonly firstTradeAt: number; // unix ms (0 if no trades)
  readonly lastTradeAt: number; // unix ms (0 if no trades)
}
