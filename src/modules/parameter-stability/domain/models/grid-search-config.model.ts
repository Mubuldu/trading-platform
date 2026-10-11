/**
 * Cartesian-product grid of discrete parameter values.
 * Each key maps to the list of values to try for that parameter.
 *
 * Example:
 *   { period: [10, 20, 30], multiplier: [1.5, 2.0] }
 *   → 6 combinations
 */
export type ParameterGrid = Record<string, number[]>;

export interface GridSearchConfig {
  readonly grid: ParameterGrid;
}
