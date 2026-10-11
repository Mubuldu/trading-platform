/**
 * ValidationUtils — reusable guard predicates for boundary validation.
 *
 * Use these at system boundaries (HTTP input, external data feeds, config).
 * Do NOT use them inside domain logic — domain invariants should be enforced
 * by ValueObject constructors and explicit domain rules.
 */
export const ValidationUtils = {
  isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  },

  isPositiveInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
  },

  isNonNegativeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
  },

  isPositiveFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && isFinite(value) && value > 0;
  },

  isInRange(value: number, min: number, max: number): boolean {
    return value >= min && value <= max;
  },

  isUuid(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  },

  isIsoDateString(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    const d = new Date(value);
    return !isNaN(d.getTime());
  },

  isOneOf<T>(value: unknown, allowed: readonly T[]): value is T {
    return allowed.includes(value as T);
  },

  isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  },

  isNonEmptyArray<T>(value: unknown): value is T[] {
    return Array.isArray(value) && value.length > 0;
  },

  /**
   * Validates that a string matches a ticker symbol format.
   * Accepts 1-10 uppercase letters, optionally followed by / and another group.
   * Examples: BTC, AAPL, BTC/USDT, EUR/USD.
   */
  isTickerSymbol(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    return /^[A-Z]{1,10}(?:\/[A-Z]{1,10})?$/.test(value);
  },
} as const;
