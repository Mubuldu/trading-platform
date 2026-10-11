import {
  ExponentialBackoff,
  LinearBackoff,
  ConstantBackoff,
  NoBackoff,
} from '@common/resilience/backoff.strategy';

describe('BackoffStrategy implementations', () => {
  describe('ExponentialBackoff', () => {
    it('returns 0 for first attempt with jitter disabled', () => {
      const b = new ExponentialBackoff({ baseMs: 100, jitter: false });
      expect(b.getDelayMs(1)).toBe(100);
    });

    it('doubles delay each attempt without jitter', () => {
      const b = new ExponentialBackoff({ baseMs: 100, factor: 2, jitter: false });
      expect(b.getDelayMs(1)).toBe(100);
      expect(b.getDelayMs(2)).toBe(200);
      expect(b.getDelayMs(3)).toBe(400);
    });

    it('caps at maxMs', () => {
      const b = new ExponentialBackoff({ baseMs: 100, maxMs: 500, factor: 10, jitter: false });
      expect(b.getDelayMs(3)).toBe(500);
    });

    it('returns value in range [0, expected] with jitter', () => {
      const b = new ExponentialBackoff({ baseMs: 100, factor: 2, jitter: true });
      for (let attempt = 1; attempt <= 5; attempt++) {
        const delay = b.getDelayMs(attempt);
        const expectedMax = Math.min(100 * Math.pow(2, attempt - 1), 30_000);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(expectedMax);
      }
    });
  });

  describe('LinearBackoff', () => {
    it('grows linearly', () => {
      const b = new LinearBackoff(200, 10_000);
      expect(b.getDelayMs(1)).toBe(200);
      expect(b.getDelayMs(2)).toBe(400);
      expect(b.getDelayMs(3)).toBe(600);
    });

    it('caps at maxMs', () => {
      const b = new LinearBackoff(500, 1_000);
      expect(b.getDelayMs(3)).toBe(1_000);
    });
  });

  describe('ConstantBackoff', () => {
    it('always returns the same delay', () => {
      const b = new ConstantBackoff(500);
      expect(b.getDelayMs(1)).toBe(500);
      expect(b.getDelayMs(10)).toBe(500);
      expect(b.getDelayMs(100)).toBe(500);
    });
  });

  describe('NoBackoff', () => {
    it('always returns 0', () => {
      const b = new NoBackoff();
      expect(b.getDelayMs(1)).toBe(0);
      expect(b.getDelayMs(100)).toBe(0);
    });
  });
});
