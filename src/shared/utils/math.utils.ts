/**
 * MathUtils — statistical and financial math helpers.
 *
 * All functions accept plain arrays and return plain numbers.
 * They throw RangeError on invalid inputs (empty arrays, division by zero)
 * because these represent programming errors, not expected business failures.
 */
export const MathUtils = {
  sum(values: number[]): number {
    return values.reduce((acc, v) => acc + v, 0);
  },

  mean(values: number[]): number {
    if (values.length === 0) throw new RangeError('Cannot compute mean of empty array');
    return MathUtils.sum(values) / values.length;
  },

  /**
   * Population variance (divides by N).
   */
  variance(values: number[]): number {
    if (values.length < 2) throw new RangeError('Variance requires at least 2 values');
    const avg = MathUtils.mean(values);
    return MathUtils.sum(values.map((v) => Math.pow(v - avg, 2))) / values.length;
  },

  /**
   * Sample variance (divides by N-1) — unbiased estimator.
   */
  sampleVariance(values: number[]): number {
    if (values.length < 2) throw new RangeError('Sample variance requires at least 2 values');
    const avg = MathUtils.mean(values);
    return MathUtils.sum(values.map((v) => Math.pow(v - avg, 2))) / (values.length - 1);
  },

  /**
   * Population standard deviation.
   */
  stdDev(values: number[]): number {
    return Math.sqrt(MathUtils.variance(values));
  },

  /**
   * Sample standard deviation.
   */
  sampleStdDev(values: number[]): number {
    return Math.sqrt(MathUtils.sampleVariance(values));
  },

  min(values: number[]): number {
    if (values.length === 0) throw new RangeError('Cannot compute min of empty array');
    return Math.min(...values);
  },

  max(values: number[]): number {
    if (values.length === 0) throw new RangeError('Cannot compute max of empty array');
    return Math.max(...values);
  },

  median(values: number[]): number {
    if (values.length === 0) throw new RangeError('Cannot compute median of empty array');
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  },

  /**
   * Simple moving average over the last `period` values.
   */
  sma(values: number[], period: number): number[] {
    if (period <= 0) throw new RangeError('SMA period must be positive');
    if (values.length < period) return [];
    const result: number[] = [];
    for (let i = period - 1; i < values.length; i++) {
      const window = values.slice(i - period + 1, i + 1);
      result.push(MathUtils.mean(window));
    }
    return result;
  },

  /**
   * Exponential moving average.
   * k = 2 / (period + 1) — standard Wilder-style smoothing.
   */
  ema(values: number[], period: number): number[] {
    if (period <= 0) throw new RangeError('EMA period must be positive');
    if (values.length < period) return [];
    const k = 2 / (period + 1);
    const result: number[] = [MathUtils.mean(values.slice(0, period))];
    for (let i = period; i < values.length; i++) {
      result.push(values[i] * k + result[result.length - 1] * (1 - k));
    }
    return result;
  },

  /**
   * Linearly interpolates between a and b by factor t ∈ [0, 1].
   */
  lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  },
} as const;
