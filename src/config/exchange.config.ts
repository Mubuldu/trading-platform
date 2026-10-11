import { registerAs } from '@nestjs/config';

export interface ExchangeConfig {
  defaultExchangeId: string;
  marketDataCacheTtlMs: number;
  orderBookDepth: number;
  tickerCacheTtlMs: number;
  connectionTimeoutMs: number;
  enabledExchanges: string[];
}

export const exchangeConfig = registerAs('exchange', (): ExchangeConfig => ({
  defaultExchangeId: process.env.EXCHANGE_DEFAULT_ID ?? 'BINANCE_SPOT',
  marketDataCacheTtlMs: parseInt(process.env.EXCHANGE_MARKET_DATA_CACHE_TTL_MS ?? '300000', 10),
  orderBookDepth: parseInt(process.env.EXCHANGE_ORDER_BOOK_DEPTH ?? '20', 10),
  tickerCacheTtlMs: parseInt(process.env.EXCHANGE_TICKER_CACHE_TTL_MS ?? '5000', 10),
  connectionTimeoutMs: parseInt(process.env.EXCHANGE_CONNECTION_TIMEOUT_MS ?? '10000', 10),
  enabledExchanges: (process.env.EXCHANGE_ENABLED ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
}));
