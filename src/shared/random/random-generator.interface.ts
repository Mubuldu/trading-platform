/**
 * RandomGenerator abstracts random number generation for testability.
 *
 * Trading systems often need random numbers for:
 *  - Jitter in backoff strategies (to prevent thundering herd)
 *  - Monte Carlo simulations
 *  - Stochastic sampling in risk calculations
 *
 * Injecting a seeded RandomGenerator in tests makes these deterministic.
 */
export interface RandomGenerator {
  nextFloat(): number;
  nextInt(min: number, max: number): number;
  nextFloatBetween(min: number, max: number): number;
  shuffle<T>(array: T[]): T[];
}
