/**
 * OrderStatus is the canonical internal representation of an order's lifecycle.
 *
 * Every exchange uses different terminology and intermediate states.
 * The adapter normalizes exchange-specific statuses to these values
 * before exposing them to the rest of the platform.
 *
 * Mapping examples:
 *   Binance "PARTIALLY_FILLED" → PARTIALLY_FILLED
 *   Bybit "PartiallyFilled"    → PARTIALLY_FILLED
 *   Coinbase "OPEN"            → NEW or PARTIALLY_FILLED (requires quantity check)
 */
export enum OrderStatus {
  NEW = 'NEW',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  FILLED = 'FILLED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  PENDING_CANCEL = 'PENDING_CANCEL',
  /**
   * UNKNOWN is returned when the exchange returns a status string the platform
   * does not recognise. Consumers must treat UNKNOWN defensively — do not
   * assume the order is open or closed. Log a warning and escalate for
   * investigation; the mapping table needs to be updated.
   */
  UNKNOWN = 'UNKNOWN',
}

export enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

/**
 * OrderType covers all order types that at least one supported exchange provides.
 * An adapter that doesn't support a type must throw UnsupportedOperationError
 * when that type is requested, not silently degrade.
 */
export enum OrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
  STOP = 'STOP',
  STOP_LIMIT = 'STOP_LIMIT',
  TRAILING_STOP = 'TRAILING_STOP',
  TAKE_PROFIT = 'TAKE_PROFIT',
  TAKE_PROFIT_LIMIT = 'TAKE_PROFIT_LIMIT',
}

export enum TimeInForce {
  GTC = 'GTC',
  IOC = 'IOC',
  FOK = 'FOK',
  POST_ONLY = 'POST_ONLY',
}
