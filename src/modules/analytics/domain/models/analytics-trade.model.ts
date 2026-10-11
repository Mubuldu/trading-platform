/**
 * AnalyticsTrade is the analytics-domain representation of a completed
 * round-trip trade (position open → position close).
 *
 * This is the canonical input type for all trade-level analytics calculators.
 * It is constructed from raw fills by AnalyticsDataCollectorService using
 * position-accounting logic (FIFO average-cost method).
 *
 * Field invariants:
 *   durationMs  = exitTime - entryTime  (always ≥ 0)
 *   grossPnl    = (exitPrice - entryPrice) × quantity for LONG
 *                 (entryPrice - exitPrice) × quantity for SHORT
 *   netPnl      = grossPnl - commission
 *   slippage    ≥ 0  (total absolute slippage in quote currency, both legs)
 */
export interface AnalyticsTrade {
  readonly tradeId: string;
  readonly strategyId: string;
  readonly symbol: string;
  readonly exchangeId: string;

  /** Position direction — LONG means bought first, SHORT means sold first. */
  readonly side: 'LONG' | 'SHORT';

  readonly entryTime: number; // unix ms
  readonly exitTime: number; // unix ms
  readonly entryPrice: number; // average cost basis
  readonly exitPrice: number; // average exit price

  /** Total filled quantity (base asset). */
  readonly quantity: number;

  readonly grossPnl: number; // PnL before fees
  readonly commission: number; // total fees (entry + exit)
  readonly netPnl: number; // grossPnl - commission

  readonly slippage: number; // total slippage in quote currency
  readonly durationMs: number; // exitTime - entryTime
}

/**
 * AnalyticsFill is the analytics-domain view of a single order fill.
 * Used for execution quality metrics (slippage, latency, fill rates).
 */
export interface AnalyticsFill {
  readonly fillId: string;
  readonly orderId: string;
  readonly strategyId: string;
  readonly symbol: string;
  readonly exchangeId: string;
  readonly side: string;
  readonly filledQuantity: number;
  readonly fillPrice: number;
  readonly notional: number;
  readonly commission: number;
  readonly slippage: number;
  readonly realizedPnl: number;
  readonly filledAt: number; // unix ms
  readonly latencyMs?: number; // order-to-fill latency (if available)
}

/**
 * AnalyticsEquityPoint is a time-stamped equity observation.
 * Derived from daily PnL records for curve calculations.
 */
export interface AnalyticsEquityPoint {
  readonly timestamp: number; // unix ms (start of day)
  readonly date: string; // YYYY-MM-DD
  readonly equity: number;
  readonly cashBalance: number;
  readonly dailyReturn: number; // fractional (e.g. 0.02 = +2%)
  readonly cumulativeReturn: number; // fractional from period start
}

/**
 * AnalyticsPositionSnapshot is a point-in-time view of one open position.
 * Used for exposure metric calculations.
 */
export interface AnalyticsPositionSnapshot {
  readonly positionId: string;
  readonly strategyId: string;
  readonly symbol: string;
  readonly exchangeId: string;
  readonly direction: 'LONG' | 'SHORT';
  readonly quantity: number;
  readonly averageEntryPrice: number;
  readonly notional: number; // quantity × averageEntryPrice
  readonly unrealizedPnl: number;
}
