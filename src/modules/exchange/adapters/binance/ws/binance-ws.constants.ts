/** WebSocket base URLs for Binance Spot. */
export const BINANCE_WS_SPOT_BASE_URL = 'wss://stream.binance.com:9443';
export const BINANCE_WS_TESTNET_BASE_URL = 'wss://testnet.binance.vision';

/** Maximum number of streams per combined connection (Binance limit). */
export const BINANCE_WS_MAX_STREAMS_PER_CONNECTION = 1_024;

/** Binance WebSocket stream paths. */
export const BINANCE_WS_STREAM_PATH = '/stream';

/**
 * Builds the Binance stream name for a 24-hour rolling ticker.
 * e.g. buildTickerStream('BTCUSDT') → 'btcusdt@ticker'
 */
export function buildTickerStream(exchangeSymbol: string): string {
  return `${exchangeSymbol.toLowerCase()}@ticker`;
}

/**
 * Builds the Binance stream name for the partial order book (snapshot updates).
 * Speed options: '@100ms' (default) or '@1000ms'.
 * e.g. buildDepthStream('BTCUSDT', 20) → 'btcusdt@depth20@100ms'
 */
export function buildDepthStream(
  exchangeSymbol: string,
  levels: 5 | 10 | 20 = 20,
  speedMs: 100 | 1000 = 100,
): string {
  return `${exchangeSymbol.toLowerCase()}@depth${levels}@${speedMs}ms`;
}

/**
 * Builds the Binance stream name for the diff (incremental) order book.
 * e.g. buildDiffDepthStream('BTCUSDT') → 'btcusdt@depth@100ms'
 */
export function buildDiffDepthStream(exchangeSymbol: string, speedMs: 100 | 1000 = 100): string {
  return `${exchangeSymbol.toLowerCase()}@depth@${speedMs}ms`;
}

/**
 * Builds the Binance stream name for the aggregate trade stream.
 * e.g. buildTradeStream('BTCUSDT') → 'btcusdt@aggTrade'
 */
export function buildTradeStream(exchangeSymbol: string): string {
  return `${exchangeSymbol.toLowerCase()}@aggTrade`;
}

/** Binance subscribe/unsubscribe method names (JSON-RPC style). */
export const BINANCE_WS_METHOD = {
  SUBSCRIBE: 'SUBSCRIBE',
  UNSUBSCRIBE: 'UNSUBSCRIBE',
  LIST: 'LIST_SUBSCRIPTIONS',
} as const;

/** Binance WebSocket event type strings (e field in message data). */
export const BINANCE_WS_EVENT = {
  TICKER: '24hrTicker',
  MINI_TICKER: '24hrMiniTicker',
  AGG_TRADE: 'aggTrade',
  DEPTH_UPDATE: 'depthUpdate',
  KLINE: 'kline',
  BOOK_TICKER: 'bookTicker',
} as const;
