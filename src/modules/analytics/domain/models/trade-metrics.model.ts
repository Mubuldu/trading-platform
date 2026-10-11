/**
 * TradeMetrics captures time-based and sequencing statistics about trades.
 *
 * holdingTime*  — milliseconds between position entry and exit
 * barsHeld      — holdingTime / barDurationMs  (0 when barDuration not provided)
 * tradeFrequency— trades per unit time (per day / per week)
 * longestFlatMs — longest gap between consecutive trades (no position open)
 */
export interface TradeMetrics {
  // Holding time (milliseconds)
  readonly averageHoldingTimeMs: number;
  readonly maxHoldingTimeMs: number;
  readonly minHoldingTimeMs: number;

  // Bars held (0 when barDurationMs is not configured)
  readonly averageBarsHeld: number;
  readonly maxBarsHeld: number;

  // Streaks
  readonly maxConsecutiveWins: number;
  readonly maxConsecutiveLosses: number;

  // Flat period — longest gap between trade exits (ms)
  readonly longestFlatPeriodMs: number;

  // Frequency
  readonly tradeFrequencyPerDay: number;
  readonly tradeFrequencyPerWeek: number;

  // Period
  readonly firstTradeAt: number; // unix ms (0 if no trades)
  readonly lastTradeAt: number; // unix ms (0 if no trades)
  readonly totalPeriodMs: number; // lastTradeAt - firstTradeAt

  readonly computedAt: number;
}
