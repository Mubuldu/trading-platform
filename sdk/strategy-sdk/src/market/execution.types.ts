/**
 * SdkOrderStatus is the normalized status of an order on the exchange.
 *
 * Strategies observe execution reports as read-only data — they NEVER
 * submit, cancel, or modify orders directly.
 */
export enum SdkOrderStatus {
  NEW              = 'NEW',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  FILLED           = 'FILLED',
  CANCELLED        = 'CANCELLED',
  REJECTED         = 'REJECTED',
  EXPIRED          = 'EXPIRED',
  UNKNOWN          = 'UNKNOWN',
}

/**
 * SdkExecutionReport is a normalized fill or order lifecycle event.
 *
 * The platform delivers execution reports to strategies via:
 *   - onOrderFilled()  — when status transitions to FILLED or PARTIALLY_FILLED
 *   - onOrderRejected() — when status transitions to REJECTED or CANCELLED by the exchange
 *
 * Strategies may also read historical fills via ctx.executionReports.getRecentFills().
 *
 * commission is always positive. commissionAsset is the asset deducted (e.g. "USDT", "BNB").
 * strategyId links the fill back to the strategy that generated the originating signal.
 */
export interface SdkExecutionReport {
  readonly orderId: string;
  readonly clientOrderId: string;
  readonly symbol: string;
  readonly exchange: string;
  readonly status: SdkOrderStatus;
  readonly side: 'BUY' | 'SELL';
  readonly executedQuantity: number;
  readonly executedPrice: number;
  readonly cumulativeQuoteQuantity: number;
  readonly commission: number;
  readonly commissionAsset: string;
  readonly strategyId: string;
  readonly timestamp: number;
  readonly rejectReason: string | null;
}
