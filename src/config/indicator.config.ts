import { registerAs } from '@nestjs/config';

export interface IndicatorConfig {
  warmupTimeoutMs: number;
  maxFutureTimestampSkewMs: number;
  defaultExchangeId: string;
  defaultSymbols: string[];
}

export const indicatorConfig = registerAs('indicator', (): IndicatorConfig => ({
  warmupTimeoutMs: parseInt(process.env.INDICATOR_WARMUP_TIMEOUT_MS ?? '120000', 10),
  maxFutureTimestampSkewMs: parseInt(process.env.INDICATOR_MAX_FUTURE_SKEW_MS ?? '5000', 10),
  defaultExchangeId: process.env.INDICATOR_DEFAULT_EXCHANGE_ID ?? 'BINANCE_SPOT',
  defaultSymbols: (process.env.INDICATOR_DEFAULT_SYMBOLS ?? 'BTC/USDT')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
}));
