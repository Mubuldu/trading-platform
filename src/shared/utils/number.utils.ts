/**
 * NumberUtils — safe numeric operations for financial calculations.
 *
 * JavaScript floats accumulate representation errors. Always use these
 * precision-aware helpers when dealing with prices, quantities, and
 * percentages. For production trading, consider migrating to decimal
 * arithmetic (decimal.js, big.js) once the platform matures.
 */
export const NumberUtils = {
  /**
   * Rounds to the given decimal places using "round half up" (banker-safe).
   */
  round(value: number, decimals: number): number {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  },

  /**
   * Truncates to the given decimal places (floor toward zero).
   */
  truncate(value: number, decimals: number): number {
    const factor = Math.pow(10, decimals);
    return Math.trunc(value * factor) / factor;
  },

  /**
   * Floors to the given decimal places.
   * Used for order quantity truncation (never over-fill).
   */
  floor(value: number, decimals: number): number {
    const factor = Math.pow(10, decimals);
    return Math.floor(value * factor) / factor;
  },

  /**
   * Ceils to the given decimal places.
   */
  ceil(value: number, decimals: number): number {
    const factor = Math.pow(10, decimals);
    return Math.ceil(value * factor) / factor;
  },

  /**
   * Compares two floats within a tolerance (epsilon).
   * Required because 0.1 + 0.2 !== 0.3 in IEEE 754.
   */
  approximately(a: number, b: number, epsilon = 1e-10): boolean {
    return Math.abs(a - b) < epsilon;
  },

  clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  },

  isFiniteAndPositive(value: number): boolean {
    return isFinite(value) && value > 0;
  },

  isFiniteAndNonNegative(value: number): boolean {
    return isFinite(value) && value >= 0;
  },

  isValidPrice(value: unknown): value is number {
    return typeof value === 'number' && isFinite(value) && value > 0;
  },

  isValidQuantity(value: unknown): value is number {
    return typeof value === 'number' && isFinite(value) && value > 0;
  },

  /**
   * Converts a decimal to basis points (100bp = 1%).
   */
  toBasisPoints(decimal: number): number {
    return NumberUtils.round(decimal * 10_000, 0);
  },

  fromBasisPoints(bps: number): number {
    return bps / 10_000;
  },

  /**
   * Returns the percentage change from oldValue to newValue.
   */
  percentageChange(oldValue: number, newValue: number): number {
    if (oldValue === 0) throw new RangeError('Cannot compute percentage change from zero');
    return ((newValue - oldValue) / Math.abs(oldValue)) * 100;
  },

  formatWithDecimals(value: number, decimals: number): string {
    return value.toFixed(decimals);
  },
} as const;
