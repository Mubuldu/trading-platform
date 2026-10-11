import { Injectable } from '@nestjs/common';
import { ParameterRange, RandomSearchConfig } from '../domain/models/random-search-config.model';

/**
 * RandomSearchService
 *
 * Samples parameter combinations at random from continuous (or integer-stepped)
 * ranges.  When `seed` is provided the internal LCG PRNG is seeded
 * deterministically, making the search reproducible.
 *
 * Random search is generally more efficient than grid search when only a few
 * parameters are actually important, because it spreads samples more evenly
 * across the marginal distributions (Bergstra & Bengio, 2012).
 */
@Injectable()
export class RandomSearchService {
  /**
   * Generates `config.nTrials` parameter combinations.
   * Each call with the same seed returns the identical sequence.
   */
  sample(config: RandomSearchConfig): Record<string, number>[] {
    const rng = this.makeRng(config.seed);
    const keys = Object.keys(config.ranges);
    const results: Record<string, number>[] = [];

    for (let i = 0; i < config.nTrials; i++) {
      const combination: Record<string, number> = {};
      for (const key of keys) {
        combination[key] = this.sampleValue(config.ranges[key], rng);
      }
      results.push(combination);
    }

    return results;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private sampleValue(range: ParameterRange, rng: () => number): number {
    const { min, max, integer, step } = range;
    let val = min + rng() * (max - min);

    if (step !== undefined && step > 0) {
      val = Math.round(val / step) * step;
    }
    if (integer) {
      val = Math.floor(val);
    }

    // Clamp to [min, max] after rounding
    return Math.min(max, Math.max(min, val));
  }

  /**
   * Linear Congruential Generator (LCG) — Numerical Recipes constants.
   * Returns a function that yields uniform floats in [0, 1).
   */
  private makeRng(seed?: number): () => number {
    // Mask is 2³² − 1 (0xFFFFFFFF); we use unsigned right-shift for clarity.
    let s = seed !== undefined ? seed | 0 : Date.now() & 0xffffffff;
    return (): number => {
      s = Math.imul(s, 1664525) + 1013904223;
      // Convert signed int32 to [0, 1)
      return (s >>> 0) / 0x100000000;
    };
  }
}
