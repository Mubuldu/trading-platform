/**
 * Clock is the single source of time for the entire platform.
 *
 * Every component that needs the current time MUST inject a Clock instead of
 * calling new Date() or Date.now() directly. This discipline makes all
 * time-sensitive code trivially testable with a MockClock.
 *
 * In trading, this matters for:
 *  - Order timestamps (must be deterministic in tests)
 *  - Candlestick period boundaries
 *  - Rate limit windows
 *  - Session open/close detection
 *  - Backoff and timeout calculations
 */
export interface Clock {
  now(): Date;
  nowMs(): number;
  today(): Date;
}
