/**
 * SdkTimeframe lists every supported candle interval.
 *
 * Values are stable SDK constants — additions are minor-version changes,
 * removals require a major-version bump.
 */
export type SdkTimeframe =
  | '1m' | '3m' | '5m' | '15m' | '30m'
  | '1h' | '2h' | '4h' | '6h' | '8h' | '12h'
  | '1d' | '3d' | '1w' | '1M';

/**
 * SdkCandle is the normalized OHLCV candle delivered to strategies.
 *
 * All numeric fields are IEEE-754 doubles — safe for prices and volumes as long
 * as you use standard comparison and rounding techniques (not ===).
 *
 * openTime and closeTime are UNIX milliseconds (UTC).
 *
 * isClosed: true  → candle is finalized (bar is closed on the exchange)
 * isClosed: false → real-time, partially-complete candle (subject to change)
 *
 * Strategies that only trade on closed candles should check isClosed === true
 * before processing.
 */
export interface SdkCandle {
  readonly symbol: string;
  readonly exchange: string;
  readonly timeframe: SdkTimeframe;
  readonly openTime: number;
  readonly closeTime: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  readonly isClosed: boolean;
}
