/**
 * ExchangeId uniquely identifies an exchange and its market type.
 *
 * An exchange like Binance has separate API endpoints and rules for spot,
 * futures, and options. They are treated as distinct adapters even though
 * they share a brand name.
 *
 * Extension: add new entries here when a new exchange or market type is
 * supported. Do not remove existing entries — order IDs stored in the
 * database are tagged with these values.
 */
export enum ExchangeId {
  BINANCE_SPOT = 'binance_spot',
  BINANCE_FUTURES_USDT = 'binance_futures_usdt',
  BINANCE_FUTURES_COIN = 'binance_futures_coin',
  BYBIT_SPOT = 'bybit_spot',
  BYBIT_LINEAR = 'bybit_linear',
  BYBIT_INVERSE = 'bybit_inverse',
  COINBASE_ADVANCED = 'coinbase_advanced',
  OKX_SPOT = 'okx_spot',
  OKX_FUTURES = 'okx_futures',
  KRAKEN_SPOT = 'kraken_spot',
  KRAKEN_FUTURES = 'kraken_futures',
  PAPER_TRADING = 'paper_trading',
}

/**
 * MarketType classifies the structure of a trading market.
 * Affects leverage availability, settlement, and margin rules.
 */
export enum MarketType {
  SPOT = 'SPOT',
  PERPETUAL = 'PERPETUAL',
  FUTURES = 'FUTURES',
  OPTIONS = 'OPTIONS',
  MARGIN = 'MARGIN',
}
