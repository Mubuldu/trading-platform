import { SdkCandle, SdkTimeframe } from '../market/candle.types';

/**
 * HistoricalDataQuery describes what historical candles to retrieve.
 *
 * symbol    — normalized symbol (e.g. "BTC/USDT")
 * timeframe — candle interval
 * limit     — number of candles to return, capped at 1000; platform may return fewer
 * endTime   — if provided, return candles whose closeTime <= endTime (UNIX ms);
 *             if omitted, return the most recent `limit` candles
 */
export interface HistoricalDataQuery {
  readonly symbol: string;
  readonly timeframe: SdkTimeframe;
  readonly limit: number;
  readonly endTime?: number;
}

/**
 * IHistoricalDataReader provides access to historical OHLCV candle data.
 *
 * Requires: StrategyPermission.READ_HISTORICAL_DATA
 *
 * Historical data is read-only and sourced from the platform's candle store
 * (typically a PostgreSQL database or a local flat-file cache). Strategies use
 * this during onWarmup() to pre-load indicator state, and optionally during
 * signal generation for multi-timeframe lookbacks.
 *
 * getCandles() is ASYNC — it may perform I/O. Strategies should call it
 * during onWarmup(), not on every generateSignal() tick (which would be too slow).
 * Batch your data loading at warmup time and cache the results internally.
 *
 * Returned candles are sorted ascending by openTime (oldest first).
 * isClosed is always true for historical candles.
 */
export interface IHistoricalDataReader {
  getCandles(query: HistoricalDataQuery): Promise<readonly SdkCandle[]>;
}
