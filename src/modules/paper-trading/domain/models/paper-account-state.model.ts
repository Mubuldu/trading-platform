/**
 * PaperAccountState is the complete virtual account snapshot.
 *
 * balance       — available quote asset (USDT) not tied to open orders
 * lockedBalance — quote asset reserved for open buy orders
 * equity        — balance + unrealizedPnl across all positions
 * peakEquity    — highest equity ever reached (used for drawdown calc)
 *
 * All values are in the quote currency (USDT).
 */
export interface PaperAccountState {
  balance: number;
  lockedBalance: number;
  equity: number;
  peakEquity: number;
  totalRealizedPnl: number;
  totalFees: number;
  totalFunding: number;
  tradeCount: number;
  startedAt: number;
  updatedAt: number;
}

/**
 * PaperFillRecord is the immutable audit trail of a completed fill.
 * Stored in a Redis list; used for trade history and PnL reports.
 */
export interface PaperFillRecord {
  readonly fillId: string;
  readonly orderId: string;
  readonly requestId: string;
  readonly decisionId: string;
  readonly strategyId: string;
  readonly symbol: string;
  readonly side: string;
  readonly orderType: string;
  readonly isMaker: boolean;
  readonly filledQuantity: number;
  readonly fillPrice: number;
  readonly notional: number;
  readonly commission: number;
  readonly slippage: number;
  readonly realizedPnl: number;
  readonly filledAt: number;
}

/**
 * PaperDailyRecord is a daily PnL snapshot appended each calendar day.
 */
export interface PaperDailyRecord {
  readonly date: string; // YYYY-MM-DD
  readonly openEquity: number;
  readonly closeEquity: number;
  readonly realizedPnl: number;
  readonly unrealizedPnl: number;
  readonly fees: number;
  readonly funding: number;
  readonly netPnl: number;
  readonly returnPercent: number;
  readonly tradeCount: number;
}

/**
 * PaperPositionState tracks a single symbol's open position in memory + Redis.
 */
export interface PaperPositionState {
  readonly positionId: string;
  readonly symbol: string;
  readonly strategyId: string;
  direction: 'LONG' | 'SHORT' | 'FLAT';
  quantity: number;
  averageEntryPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalFees: number;
  totalFunding: number;
  openedAt: number;
  updatedAt: number;
}
