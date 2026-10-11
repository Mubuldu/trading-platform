export const OKX_TOKENS = {
  CONFIG: Symbol('OkxConfig'),
} as const;

export const OKX_REST_BASE_URL = 'https://www.okx.com';
export const OKX_TESTNET_BASE_URL = 'https://www.okx.com'; // OKX uses demo trading via header
export const OKX_WS_PUBLIC_BASE_URL = 'wss://ws.okx.com:8443/ws/v5/public';
export const OKX_WS_PRIVATE_BASE_URL = 'wss://ws.okx.com:8443/ws/v5/private';
export const OKX_WS_BUSINESS_BASE_URL = 'wss://ws.okx.com:8443/ws/v5/business';

/**
 * OKX V5 REST API endpoints.
 * Reference: https://www.okx.com/docs-v5/en/
 *
 * OKX uses instType query param to scope endpoints:
 *   SPOT, MARGIN, SWAP (perpetual), FUTURES, OPTION
 */
export const OKX_ENDPOINTS = {
  SERVER_TIME: '/api/v5/public/time',
  INSTRUMENTS: '/api/v5/public/instruments',
  TICKER: '/api/v5/market/ticker',
  ORDER_BOOK: '/api/v5/market/books',
  RECENT_TRADES: '/api/v5/market/trades',
  FUNDING_RATE: '/api/v5/public/funding-rate',
  MARK_PRICE: '/api/v5/public/mark-price',

  // Trading
  ORDER: '/api/v5/trade/order',
  BATCH_ORDERS: '/api/v5/trade/batch-orders',
  CANCEL_ORDER: '/api/v5/trade/cancel-order',
  BATCH_CANCEL: '/api/v5/trade/cancel-batch-orders',
  AMEND_ORDER: '/api/v5/trade/amend-order',
  CLOSE_POSITION: '/api/v5/trade/close-position',
  PENDING_ORDERS: '/api/v5/trade/orders-pending',
  ORDER_HISTORY: '/api/v5/trade/orders-history',
  FILLS: '/api/v5/trade/fills',

  // Account
  BALANCE: '/api/v5/account/balance',
  ACCOUNT_CONFIG: '/api/v5/account/config',
  POSITIONS: '/api/v5/account/positions',
  SET_LEVERAGE: '/api/v5/account/set-leverage',
  SET_MARGIN_MODE: '/api/v5/account/set-account-level',
  FEE_RATES: '/api/v5/account/trade-fee',
} as const;

export const OKX_INST_TYPE = {
  SPOT: 'SPOT',
  MARGIN: 'MARGIN',
  SWAP: 'SWAP', // perpetual
  FUTURES: 'FUTURES',
  OPTION: 'OPTION',
} as const;

export const OKX_RATE_LIMITS = {
  /** OKX: 20 req/2s per IP for market endpoints */
  MARKET_PER_2S: 20,
  /** Trading: 60 req/2s per UID */
  TRADING_PER_2S: 60,
  WARN_THRESHOLD: 0.8,
  PAUSE_THRESHOLD: 0.95,
} as const;
