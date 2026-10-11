export const BINANCE_TOKENS = {
  CONFIG: Symbol('BinanceSpotConfig'),
} as const;

export const BINANCE_SPOT_BASE_URL = 'https://api.binance.com';
export const BINANCE_TESTNET_BASE_URL = 'https://testnet.binance.vision';

// WebSocket URL defaults — also defined in binance-ws.constants.ts (adapter-internal).
// Re-exported here for use in binance.config.ts without creating a cross-layer import.
export const BINANCE_WS_SPOT_BASE_URL = 'wss://stream.binance.com:9443';
export const BINANCE_WS_TESTNET_BASE_URL = 'wss://testnet.binance.vision';

export const BINANCE_ENDPOINTS = {
  PING: '/api/v3/ping',
  SERVER_TIME: '/api/v3/time',
  EXCHANGE_INFO: '/api/v3/exchangeInfo',
  TICKER_24HR: '/api/v3/ticker/24hr',
  ORDER_BOOK: '/api/v3/depth',
  RECENT_TRADES: '/api/v3/trades',
  ACCOUNT: '/api/v3/account',
  ORDER: '/api/v3/order',
  ORDER_CANCEL_REPLACE: '/api/v3/order/cancelReplace',
  OPEN_ORDERS: '/api/v3/openOrders',
  ALL_ORDERS: '/api/v3/allOrders',
} as const;

/**
 * Request weights per endpoint (Binance Spot API, May 2024 limits).
 * Used for pre-request rate limit checks and post-response tracking.
 */
export const BINANCE_REQUEST_WEIGHTS = {
  PING: 1,
  SERVER_TIME: 1,
  EXCHANGE_INFO: 20,
  TICKER_24HR_SINGLE: 2,
  TICKER_24HR_ALL: 80,
  ORDER_BOOK: {
    5: 2,
    10: 5,
    20: 10,
    50: 25,
    100: 50,
    500: 250,
    1000: 500,
  },
  RECENT_TRADES: 25,
  ACCOUNT: 20,
  ORDER_SINGLE: 4,
  OPEN_ORDERS_SINGLE: 6,
  OPEN_ORDERS_ALL: 40,
  ALL_ORDERS: 20,
  CREATE_ORDER: 1,
  CANCEL_ORDER: 1,
  CANCEL_ALL_ORDERS: 1,
  CANCEL_REPLACE: 1,
} as const;

/**
 * Rate limit configuration for the Binance Spot API.
 *
 * WARN_THRESHOLD: start logging warnings when usage exceeds this fraction.
 * PAUSE_THRESHOLD: stop sending requests when usage exceeds this fraction
 * to prevent an HTTP 429 / IP ban.
 */
export const BINANCE_RATE_LIMITS = {
  REQUEST_WEIGHT_PER_MINUTE: 6_000,
  ORDERS_PER_10S: 100,
  ORDERS_PER_DAY: 200_000,
  WARN_THRESHOLD: 0.8,
  PAUSE_THRESHOLD: 0.95,
} as const;

/**
 * Binance-specific order status strings mapped to our canonical OrderStatus.
 * Registered by the adapter in orderStatusNormalizer.registerMappings().
 */
export const BINANCE_ORDER_STATUS_MAPPINGS: Record<string, string> = {
  NEW: 'NEW',
  PARTIALLY_FILLED: 'PARTIALLY_FILLED',
  FILLED: 'FILLED',
  CANCELED: 'CANCELLED',
  PENDING_CANCEL: 'PENDING_CANCEL',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  EXPIRED_IN_MATCH: 'EXPIRED',
} as const;

/**
 * Binance error codes that indicate a rate limit is being enforced.
 * The REST client applies specific retry-after logic for these.
 */
export const BINANCE_RATE_LIMIT_CODES = new Set([-1003, -1015]);

/**
 * Binance error codes that map to authentication failures.
 */
export const BINANCE_AUTH_ERROR_CODES = new Set([-1022, -2014, -2015]);

/**
 * HTTP status codes from Binance that are retryable infrastructure failures.
 */
export const BINANCE_RETRYABLE_HTTP_STATUSES = new Set([500, 502, 503, 504]);

/** Clock drift threshold (ms) above which server time is re-synced. */
export const BINANCE_CLOCK_DRIFT_THRESHOLD_MS = 1_000;

/** Interval between automatic server time refreshes (ms). */
export const BINANCE_TIME_SYNC_INTERVAL_MS = 30 * 60 * 1_000;
