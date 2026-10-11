export const KRAKEN_TOKENS = {
  CONFIG: Symbol('KrakenConfig'),
} as const;

export const KRAKEN_REST_BASE_URL = 'https://api.kraken.com';
export const KRAKEN_FUTURES_BASE_URL = 'https://futures.kraken.com';
export const KRAKEN_WS_BASE_URL = 'wss://ws.kraken.com/v2';
export const KRAKEN_FUTURES_WS_BASE_URL = 'wss://futures.kraken.com/ws/v1';

/**
 * Kraken REST v2 API endpoints (spot).
 * Reference: https://docs.kraken.com/api/docs/rest-api/get-server-time
 */
export const KRAKEN_ENDPOINTS = {
  SERVER_TIME: '/0/public/Time',
  ASSET_PAIRS: '/0/public/AssetPairs',
  TICKER: '/0/public/Ticker',
  ORDER_BOOK: '/0/public/Depth',
  RECENT_TRADES: '/0/public/Trades',

  // Private
  BALANCE: '/0/private/Balance',
  EXTENDED_BALANCE: '/0/private/BalanceEx',
  TRADE_BALANCE: '/0/private/TradeBalance',
  OPEN_ORDERS: '/0/private/OpenOrders',
  CLOSED_ORDERS: '/0/private/ClosedOrders',
  QUERY_ORDERS: '/0/private/QueryOrders',
  ADD_ORDER: '/0/private/AddOrder',
  ADD_ORDER_BATCH: '/0/private/AddOrderBatch',
  CANCEL_ORDER: '/0/private/CancelOrder',
  CANCEL_ALL: '/0/private/CancelAll',
  CANCEL_ORDER_BATCH: '/0/private/CancelOrderBatch',
  AMEND_ORDER: '/0/private/AmendOrder',
  QUERY_TRADES: '/0/private/QueryTrades',
  OPEN_POSITIONS: '/0/private/OpenPositions',
  TRADE_HISTORY: '/0/private/TradesHistory',
} as const;

/**
 * Kraken Futures API endpoints (futures.kraken.com).
 * Reference: https://docs.kraken.com/api/docs/futures-api
 */
export const KRAKEN_FUTURES_ENDPOINTS = {
  INSTRUMENTS: '/derivatives/api/v3/instruments',
  TICKER: '/derivatives/api/v3/tickers',
  ORDER_BOOK: '/derivatives/api/v3/orderbook',

  ORDER: '/derivatives/api/v3/sendorder',
  CANCEL_ORDER: '/derivatives/api/v3/cancelorder',
  CANCEL_ALL: '/derivatives/api/v3/cancelallorders',
  BATCH_ORDER: '/derivatives/api/v3/sendorder/batch',
  OPEN_ORDERS: '/derivatives/api/v3/openorders',
  FILLS: '/derivatives/api/v3/fills',

  ACCOUNT: '/derivatives/api/v3/accounts',
} as const;

export const KRAKEN_RATE_LIMITS = {
  /** Kraken: 1 req/s public, varying private (tier-based) */
  PUBLIC_PER_SECOND: 1,
  WARN_THRESHOLD: 0.8,
  PAUSE_THRESHOLD: 0.95,
} as const;

/**
 * Kraken uses non-standard symbol formats:
 *  - Spot: XXBTZUSD, XETHZUSD, XBTUSD
 *  - Futures: PF_XBTUSD, PI_XBTUSD (perpetual/inverse prefix)
 *
 * The SymbolNormalizer mapping must be seeded from the AssetPairs response.
 */
