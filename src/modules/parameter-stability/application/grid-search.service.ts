import { Injectable } from '@nestjs/common';
import { ParameterGrid } from '../domain/models/grid-search-config.model';

/**
 * GridSearchService
 *
 * Enumerates every combination in the Cartesian product of a parameter grid
 * (exhaustive grid search).  Pure computation — no I/O or NestJS dependencies.
 *
 * Usage:
 *   const combinations = gridSearch.expand({ period: [10, 20], mult: [1.5, 2.0] });
 *   // → [{period:10, mult:1.5}, {period:10, mult:2.0}, {period:20, mult:1.5}, ...]
 */
@Injectable()
export class GridSearchService {
  /**
   * Returns all parameter combinations as an ordered array.
   * Expansion order: first key varies slowest (outer loop).
   */
  expand(grid: ParameterGrid): Record<string, number>[] {
    const keys = Object.keys(grid);
    if (keys.length === 0) return [{}];

    let combinations: Record<string, number>[] = [{}];

    for (const key of keys) {
      const next: Record<string, number>[] = [];
      for (const combo of combinations) {
        for (const val of grid[key]) {
          next.push({ ...combo, [key]: val });
        }
      }
      combinations = next;
    }

    return combinations;
  }

  /** Total number of combinations without materialising them. */
  totalCombinations(grid: ParameterGrid): number {
    const keys = Object.keys(grid);
    if (keys.length === 0) return 1;
    return keys.reduce((acc, k) => acc * (grid[k].length || 1), 1);
  }
}
