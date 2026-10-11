import { NumberUtils } from '@shared/utils/number.utils';

describe('NumberUtils', () => {
  describe('round()', () => {
    it('rounds to 2 decimal places', () => {
      // 1.125 * 100 = 112.5 exactly in IEEE 754 — safe test value
      expect(NumberUtils.round(1.125, 2)).toBe(1.13);
      expect(NumberUtils.round(1.124, 2)).toBe(1.12);
      expect(NumberUtils.round(1.5, 0)).toBe(2);
      expect(NumberUtils.round(-1.5, 0)).toBe(-1);
    });
  });

  describe('floor()', () => {
    it('floors to decimal places', () => {
      expect(NumberUtils.floor(1.999, 2)).toBe(1.99);
    });
  });

  describe('ceil()', () => {
    it('ceils to decimal places', () => {
      expect(NumberUtils.ceil(1.001, 2)).toBe(1.01);
    });
  });

  describe('approximately()', () => {
    it('returns true for floating point equivalent values', () => {
      expect(NumberUtils.approximately(0.1 + 0.2, 0.3)).toBe(true);
    });
    it('returns false for clearly different values', () => {
      expect(NumberUtils.approximately(1.0, 1.1)).toBe(false);
    });
  });

  describe('clamp()', () => {
    it('clamps within range', () => {
      expect(NumberUtils.clamp(5, 0, 10)).toBe(5);
      expect(NumberUtils.clamp(-5, 0, 10)).toBe(0);
      expect(NumberUtils.clamp(15, 0, 10)).toBe(10);
    });
  });

  describe('basisPoints()', () => {
    it('converts decimal to basis points', () => {
      expect(NumberUtils.toBasisPoints(0.0025)).toBe(25);
    });
    it('round-trips through basis points', () => {
      const bps = 50;
      expect(NumberUtils.approximately(NumberUtils.fromBasisPoints(bps), 0.005)).toBe(true);
    });
  });

  describe('percentageChange()', () => {
    it('calculates positive change', () => {
      expect(NumberUtils.approximately(NumberUtils.percentageChange(100, 110), 10)).toBe(true);
    });
    it('calculates negative change', () => {
      expect(NumberUtils.approximately(NumberUtils.percentageChange(100, 90), -10)).toBe(true);
    });
    it('throws for zero oldValue', () => {
      expect(() => NumberUtils.percentageChange(0, 100)).toThrow(RangeError);
    });
  });

  describe('isValidPrice / isValidQuantity', () => {
    it('validates positive finite numbers', () => {
      expect(NumberUtils.isValidPrice(100)).toBe(true);
      expect(NumberUtils.isValidPrice(0)).toBe(false);
      expect(NumberUtils.isValidPrice(-1)).toBe(false);
      expect(NumberUtils.isValidPrice(Infinity)).toBe(false);
      expect(NumberUtils.isValidPrice('100')).toBe(false);
    });
  });
});
