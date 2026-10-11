import { SdkIndicatorValue } from '../market/indicator.types';

/**
 * IReadonlyIndicators provides access to the platform's pre-computed indicator values.
 *
 * Indicator values are keyed by a standard string: `{type}:{symbol}:{timeframe}:{period}`
 * Build keys with the indicatorKey() helper from '@trading-platform/strategy-sdk'.
 *
 * Requires: StrategyPermission.READ_INDICATORS
 *
 * Values are synchronous reads of the platform's in-memory indicator cache.
 * Undefined means the indicator has not yet computed a value (e.g. insufficient candle history).
 * Strategies should treat undefined as "not warmed up" and return null from generateSignal().
 *
 * The platform publishes indicator updates after every closed candle. Strategies
 * should call get() during generateSignal() to read the freshest values — not
 * during onCandle(), where values from the previous period are still current.
 */
export interface IReadonlyIndicators {
  /** Returns the indicator value for the given key, or undefined if not yet available. */
  get(key: string): SdkIndicatorValue | undefined;

  /**
   * Returns the complete indicator map for this signal generation cycle.
   *
   * Iterating this map is rarely necessary — prefer get() with specific keys.
   * Provided for introspection and debugging.
   */
  getAll(): ReadonlyMap<string, SdkIndicatorValue>;
}
