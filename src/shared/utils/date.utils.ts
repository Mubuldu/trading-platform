/**
 * DateUtils — pure functions for date arithmetic in a trading context.
 *
 * All functions are pure (no side effects, no I/O).
 * Never call new Date() inside utilities — accept dates as parameters so
 * the caller controls the clock.
 */
export const DateUtils = {
  /**
   * Adds the specified number of milliseconds to a date.
   * Returns a new Date — does not mutate the input.
   */
  addMs(date: Date, ms: number): Date {
    return new Date(date.getTime() + ms);
  },

  addSeconds(date: Date, seconds: number): Date {
    return DateUtils.addMs(date, seconds * 1_000);
  },

  addMinutes(date: Date, minutes: number): Date {
    return DateUtils.addMs(date, minutes * 60_000);
  },

  addHours(date: Date, hours: number): Date {
    return DateUtils.addMs(date, hours * 3_600_000);
  },

  addDays(date: Date, days: number): Date {
    return DateUtils.addMs(date, days * 86_400_000);
  },

  diffMs(from: Date, to: Date): number {
    return to.getTime() - from.getTime();
  },

  diffSeconds(from: Date, to: Date): number {
    return DateUtils.diffMs(from, to) / 1_000;
  },

  diffMinutes(from: Date, to: Date): number {
    return DateUtils.diffMs(from, to) / 60_000;
  },

  diffHours(from: Date, to: Date): number {
    return DateUtils.diffMs(from, to) / 3_600_000;
  },

  diffDays(from: Date, to: Date): number {
    return DateUtils.diffMs(from, to) / 86_400_000;
  },

  isBefore(date: Date, other: Date): boolean {
    return date.getTime() < other.getTime();
  },

  isAfter(date: Date, other: Date): boolean {
    return date.getTime() > other.getTime();
  },

  isBetween(date: Date, start: Date, end: Date): boolean {
    const t = date.getTime();
    return t >= start.getTime() && t <= end.getTime();
  },

  startOfDayUtc(date: Date): Date {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  },

  endOfDayUtc(date: Date): Date {
    const d = new Date(date);
    d.setUTCHours(23, 59, 59, 999);
    return d;
  },

  startOfHourUtc(date: Date): Date {
    const d = new Date(date);
    d.setUTCMinutes(0, 0, 0);
    return d;
  },

  startOfMinuteUtc(date: Date): Date {
    const d = new Date(date);
    d.setUTCSeconds(0, 0);
    return d;
  },

  /**
   * Returns the start of the N-minute period containing the given date.
   * Used for candlestick period boundaries (e.g. 5-minute, 15-minute candles).
   */
  startOfPeriodMinutesUtc(date: Date, periodMinutes: number): Date {
    const ms = date.getTime();
    const periodMs = periodMinutes * 60_000;
    return new Date(Math.floor(ms / periodMs) * periodMs);
  },

  toISOString(date: Date): string {
    return date.toISOString();
  },

  fromISOString(iso: string): Date {
    const d = new Date(iso);
    if (isNaN(d.getTime())) {
      throw new RangeError(`Invalid ISO date string: "${iso}"`);
    }
    return d;
  },

  isValidDate(value: unknown): value is Date {
    return value instanceof Date && !isNaN(value.getTime());
  },

  /**
   * Returns the Unix timestamp (seconds since epoch) for the given date.
   */
  toUnixSeconds(date: Date): number {
    return Math.floor(date.getTime() / 1_000);
  },

  fromUnixSeconds(seconds: number): Date {
    return new Date(seconds * 1_000);
  },
} as const;
