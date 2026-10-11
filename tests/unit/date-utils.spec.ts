import { DateUtils } from '@shared/utils/date.utils';

const base = new Date('2024-01-15T12:30:00.000Z');

describe('DateUtils', () => {
  describe('add*()', () => {
    it('addMs adds milliseconds', () => {
      expect(DateUtils.addMs(base, 5000).toISOString()).toBe('2024-01-15T12:30:05.000Z');
    });
    it('addSeconds adds seconds', () => {
      expect(DateUtils.addSeconds(base, 30).toISOString()).toBe('2024-01-15T12:30:30.000Z');
    });
    it('addMinutes adds minutes', () => {
      expect(DateUtils.addMinutes(base, 15).toISOString()).toBe('2024-01-15T12:45:00.000Z');
    });
    it('addHours adds hours', () => {
      expect(DateUtils.addHours(base, 2).toISOString()).toBe('2024-01-15T14:30:00.000Z');
    });
    it('addDays adds days', () => {
      expect(DateUtils.addDays(base, 1).toISOString()).toBe('2024-01-16T12:30:00.000Z');
    });
    it('does not mutate the input date', () => {
      const copy = new Date(base);
      DateUtils.addHours(base, 5);
      expect(base.getTime()).toBe(copy.getTime());
    });
  });

  describe('diff*()', () => {
    const later = new Date('2024-01-15T13:30:00.000Z');
    it('diffMs returns milliseconds', () => {
      expect(DateUtils.diffMs(base, later)).toBe(3_600_000);
    });
    it('diffMinutes returns minutes', () => {
      expect(DateUtils.diffMinutes(base, later)).toBe(60);
    });
    it('diffHours returns hours', () => {
      expect(DateUtils.diffHours(base, later)).toBe(1);
    });
  });

  describe('comparisons', () => {
    it('isBefore', () => {
      expect(DateUtils.isBefore(base, DateUtils.addHours(base, 1))).toBe(true);
      expect(DateUtils.isBefore(base, base)).toBe(false);
    });
    it('isAfter', () => {
      expect(DateUtils.isAfter(DateUtils.addHours(base, 1), base)).toBe(true);
    });
    it('isBetween', () => {
      const start = DateUtils.addHours(base, -1);
      const end = DateUtils.addHours(base, 1);
      expect(DateUtils.isBetween(base, start, end)).toBe(true);
      expect(DateUtils.isBetween(DateUtils.addHours(base, 2), start, end)).toBe(false);
    });
  });

  describe('period helpers', () => {
    it('startOfDayUtc returns midnight', () => {
      expect(DateUtils.startOfDayUtc(base).toISOString()).toBe('2024-01-15T00:00:00.000Z');
    });

    it('startOfPeriodMinutesUtc returns correct 5-min boundary', () => {
      const d = new Date('2024-01-15T12:32:45.000Z');
      const boundary = DateUtils.startOfPeriodMinutesUtc(d, 5);
      expect(boundary.toISOString()).toBe('2024-01-15T12:30:00.000Z');
    });

    it('startOfPeriodMinutesUtc works for 15-min candles', () => {
      const d = new Date('2024-01-15T12:47:00.000Z');
      const boundary = DateUtils.startOfPeriodMinutesUtc(d, 15);
      expect(boundary.toISOString()).toBe('2024-01-15T12:45:00.000Z');
    });
  });

  describe('Unix timestamp', () => {
    it('toUnixSeconds rounds down', () => {
      const d = new Date('2024-01-15T00:00:00.999Z');
      expect(DateUtils.toUnixSeconds(d)).toBe(1705276800);
    });
    it('fromUnixSeconds round-trips', () => {
      const unix = 1705276800;
      expect(DateUtils.fromUnixSeconds(unix).getTime()).toBe(unix * 1000);
    });
  });

  describe('fromISOString()', () => {
    it('parses valid ISO string', () => {
      expect(DateUtils.fromISOString('2024-01-15T00:00:00.000Z').toISOString()).toBe(
        '2024-01-15T00:00:00.000Z',
      );
    });
    it('throws RangeError for invalid string', () => {
      expect(() => DateUtils.fromISOString('not-a-date')).toThrow(RangeError);
    });
  });
});
