import { Candle } from '../../../../src/modules/indicator/domain/models/candle.model';
import { Timeframe } from '../../../../src/modules/indicator/domain/enums/timeframe.enum';

let ts = 1_700_000_000_000;
const INTERVAL_MS = 60_000;

export function makeCandle(overrides: Partial<Candle> = {}): Candle {
  const open = overrides.open ?? 100;
  const close = overrides.close ?? 100;
  const high = overrides.high ?? Math.max(open, close) + 1;
  const low = overrides.low ?? Math.min(open, close) - 1;
  const base: Candle = {
    symbol: 'BTC/USDT',
    exchange: 'BINANCE_SPOT',
    timeframe: Timeframe.ONE_MINUTE,
    openTime: ts,
    closeTime: ts + INTERVAL_MS - 1,
    open,
    high,
    low,
    close,
    volume: 1,
    isClosed: true,
  };
  ts += INTERVAL_MS;
  return { ...base, ...overrides };
}

export function makeCandles(count: number, overrides: Partial<Candle> = {}): Candle[] {
  return Array.from({ length: count }, () => makeCandle(overrides));
}

export function resetTimestamp(start = 1_700_000_000_000): void {
  ts = start;
}
