/**
 * Continuous (or integer-stepped) range for a single parameter during random search.
 */
export interface ParameterRange {
  readonly min: number;
  readonly max: number;
  /** When true the sampled value is floored to the nearest integer. */
  readonly integer?: boolean;
  /**
   * Optional discrete step size.  The sampled value is rounded to the nearest
   * multiple of `step` within [min, max].
   */
  readonly step?: number;
}

export interface RandomSearchConfig {
  /** One range per parameter name. */
  readonly ranges: Record<string, ParameterRange>;
  /** Number of random combinations to generate. */
  readonly nTrials: number;
  /**
   * Optional seed for the internal LCG PRNG.
   * Omit (or pass `undefined`) for a time-based, non-deterministic seed.
   */
  readonly seed?: number;
}
