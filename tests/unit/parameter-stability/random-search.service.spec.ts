import { RandomSearchService } from '@modules/parameter-stability/application/random-search.service';
import { RandomSearchConfig } from '@modules/parameter-stability/domain/models/random-search-config.model';

describe('RandomSearchService', () => {
  let service: RandomSearchService;

  beforeEach(() => {
    service = new RandomSearchService();
  });

  const config: RandomSearchConfig = {
    ranges: {
      period: { min: 5, max: 50, integer: true },
      mult: { min: 1.0, max: 3.0 },
    },
    nTrials: 20,
    seed: 42,
  };

  it('returns exactly nTrials combinations', () => {
    const results = service.sample(config);
    expect(results).toHaveLength(20);
  });

  it('all values fall within their declared ranges', () => {
    const results = service.sample(config);
    for (const combo of results) {
      expect(combo.period).toBeGreaterThanOrEqual(5);
      expect(combo.period).toBeLessThanOrEqual(50);
      expect(combo.mult).toBeGreaterThanOrEqual(1.0);
      expect(combo.mult).toBeLessThanOrEqual(3.0);
    }
  });

  it('integer parameters produce whole numbers', () => {
    const results = service.sample(config);
    for (const combo of results) {
      expect(Number.isInteger(combo.period)).toBe(true);
    }
  });

  it('non-integer parameters may be fractional', () => {
    const results = service.sample(config);
    // At least some mult values should have a fractional part
    const hasFraction = results.some((c) => c.mult % 1 !== 0);
    expect(hasFraction).toBe(true);
  });

  it('same seed produces identical sequences', () => {
    const r1 = service.sample(config);
    const r2 = service.sample(config);
    expect(r1).toEqual(r2);
  });

  it('different seeds produce different sequences', () => {
    const r1 = service.sample({ ...config, seed: 1 });
    const r2 = service.sample({ ...config, seed: 999 });
    // LCG with different seeds produces different sequences
    expect(r1).not.toEqual(r2);
  });

  it('respects step quantisation', () => {
    const stepped = service.sample({
      ranges: { p: { min: 10, max: 50, step: 5 } },
      nTrials: 50,
      seed: 7,
    });
    for (const combo of stepped) {
      expect(combo.p % 5).toBeCloseTo(0, 5);
    }
  });

  it('returns empty combinations for zero trials', () => {
    expect(service.sample({ ...config, nTrials: 0 })).toEqual([]);
  });
});
