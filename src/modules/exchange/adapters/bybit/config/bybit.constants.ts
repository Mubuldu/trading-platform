export const BYBIT_TOKENS = {
  CONFIG: Symbol('BybitConfig'),
} as const;

export const BYBIT_REST_BASE_URL = 'https://api.bybit.com';
export const BYBIT_TESTNET_BASE_URL = 'https://api-testnet.bybit.com';
export const BYBIT_WS_BASE_URL = 'wss://stream.bybit.com/v5/public/spot';
export const BYBIT_WS_LINEAR_BASE_URL = 'wss://stream.bybit.com/v5/public/linear';
export const BYBIT_WS_INVERSE_BASE_URL = 'wss://stream.bybit.com/v5/public/inverse';
export const BYBIT_WS_TESTNET_BASE_URL = 'wss://stream-testnet.bybit.com/v5/public/spot';

/**
 * Bybit V5 API endpoints.
 * Reference: https://bybit-exchange.github.io/docs/v5/intro
 */
export const BYBIT_ENDPOINTS = {
  SERVER_TIME: '/v5/market/time',
  INSTRUMENTS_INFO: '/v5/market/instruments-info',
  TICKER: '/v5/market/tickers',
  ORDER_BOOK: '/v5/market/orderbook',
  RECENT_TRADES: '/v5/market/recent-trade',
  KLINE: '/v5/market/kline',
  FUNDING_RATE: '/v5/market/funding/history',

  // Trading
  ORDER: '/v5/order/create',
  ORDER_CANCEL: '/v5/order/cancel',
  ORDER_AMEND: '/v5/order/amend',
  ORDER_CANCEL_ALL: '/v5/order/cancel-all',
  ORDER_HISTORY: '/v5/order/history',
  OPEN_ORDERS: '/v5/order/realtime',
  BATCH_ORDER: '/v5/order/create-batch',
  BATCH_CANCEL: '/v5/order/cancel-batch',

  // Account
  WALLET_BALANCE: '/v5/account/wallet-balance',
  ACCOUNT_INFO: '/v5/account/info',
  FEE_RATE: '/v5/account/fee-rate',

  // Position
  POSITIONS: '/v5/position/list',
  SET_LEVERAGE: '/v5/position/set-leverage',
  SET_TPSL_MODE: '/v5/position/set-tpsl-mode',
  SET_MARGIN_MODE: '/v5/account/set-margin-mode',
  ADD_MARGIN: '/v5/position/add-margin',
} as const;

/** Bybit category strings passed in the `category` query parameter. */
export const BYBIT_CATEGORY = {
  SPOT: 'spot',
  LINEAR: 'linear', // USDT-margined perpetuals and futures
  INVERSE: 'inverse', // Coin-margined perpetuals and futures
  OPTION: 'option',
} as const;

export const BYBIT_RATE_LIMITS = {
  /** Bybit default: 120 requests per second per IP for market data */
  MARKET_DATA_PER_SECOND: 120,
  /** Order endpoints: 10 req/s per UID */
  ORDERS_PER_SECOND: 10,
  WARN_THRESHOLD: 0.8,
  PAUSE_THRESHOLD: 0.95,
} as const;
