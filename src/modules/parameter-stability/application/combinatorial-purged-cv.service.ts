import { Injectable } from '@nestjs/common';
import { CpcvFold, CpcvFolds } from '../domain/models/cv-fold.model';

export interface CpcvConfig {
  /** Total number of time-ordered observations. */
  readonly nSamples: number;
  /** N: number of equally-sized groups to divide the data into. */
  readonly nGroups: number;
  /** k: number of groups used as test in each combination. Typically 2. */
  readonly nTestGroups: number;
  /** Samples purged on either side of each test group boundary. */
  readonly purgeWindow: number;
  /** Additional embargo after test groups. */
  readonly embargoWindow?: number;
}

/**
 * CombinatorialPurgedCvService
 *
 * Combinatorial Purged Cross-Validation (CPCV) as described in Lopez de Prado
 * (2018), "Advances in Financial Machine Learning", Chapter 12.
 *
 * Rather than the standard K-Fold approach of testing 1 group at a time (N
 * combinations), CPCV tests all C(N, k) combinations of k groups simultaneously.
 * This produces C(N,k)·k/N OOS paths that together cover the full dataset,
 * yielding a far more reliable estimate of OOS performance.
 *
 * Typical configuration:  N = 6, k = 2  →  C(6,2) = 15 combinations,
 * each using 2/6 of the data as OOS.
 *
 * The service produces fold-index arrays only — no backtesting happens here.
 * Callers iterate over `folds` and run their model/strategy on each split.
 */
@Injectable()
export class CombinatorialPurgedCvService {
  generate(config: CpcvConfig): CpcvFolds {
    const { nSamples, nGroups, nTestGroups, purgeWindow, embargoWindow = 0 } = config;

    if (nSamples <= 0 || nGroups <= 0 || nTestGroups <= 0 || nTestGroups >= nGroups) {
      return {
        folds: [],
        nCombinations: 0,
        nGroups,
        nTestGroups,
        nSamples,
        purgeWindow,
        embargoWindow,
      };
    }

    const groupBoundaries = this.buildGroupBoundaries(nSamples, nGroups);
    const combinations = this.chooseCombinations(nGroups, nTestGroups);
    const folds: CpcvFold[] = [];

    for (const testGroups of combinations) {
      const { trainIndices, testIndices } = this.buildSplit(
        testGroups,
        groupBoundaries,
        nSamples,
        purgeWindow,
        embargoWindow,
      );
      folds.push({ testGroups, trainIndices, testIndices });
    }

    return {
      folds,
      nCombinations: combinations.length,
      nGroups,
      nTestGroups,
      nSamples,
      purgeWindow,
      embargoWindow,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Divides [0, nSamples) into nGroups groups.
   * Returns an array of {start, end} (exclusive end) for each group.
   */
  private buildGroupBoundaries(
    nSamples: number,
    nGroups: number,
  ): Array<{ start: number; end: number }> {
    const baseSize = Math.floor(nSamples / nGroups);
    const remainder = nSamples % nGroups;
    const boundaries: Array<{ start: number; end: number }> = [];
    let cursor = 0;

    for (let g = 0; g < nGroups; g++) {
      // Distribute remainder samples to the first `remainder` groups.
      const size = baseSize + (g < remainder ? 1 : 0);
      boundaries.push({ start: cursor, end: cursor + size });
      cursor += size;
    }

    return boundaries;
  }

  /**
   * Generates all C(n, k) combinations of group indices as sorted arrays.
   */
  private chooseCombinations(n: number, k: number): number[][] {
    const results: number[][] = [];
    const combo: number[] = [];

    const recurse = (start: number): void => {
      if (combo.length === k) {
        results.push([...combo]);
        return;
      }
      for (let i = start; i < n; i++) {
        combo.push(i);
        recurse(i + 1);
        combo.pop();
      }
    };

    recurse(0);
    return results;
  }

  /** Constructs purged train / test index arrays for a given set of test groups. */
  private buildSplit(
    testGroups: number[],
    groupBoundaries: Array<{ start: number; end: number }>,
    nSamples: number,
    purgeWindow: number,
    embargoWindow: number,
  ): { trainIndices: number[]; testIndices: number[] } {
    const testGroupSet = new Set(testGroups);
    const testIndices: number[] = [];

    // Collect raw test indices and compute the exclusion zone
    let minTestIdx = nSamples;
    let maxTestIdx = 0;

    for (const g of testGroups) {
      const { start, end } = groupBoundaries[g];
      for (let i = start; i < end; i++) testIndices.push(i);
      minTestIdx = Math.min(minTestIdx, start);
      maxTestIdx = Math.max(maxTestIdx, end - 1);
    }

    const excludeStart = Math.max(0, minTestIdx - purgeWindow);
    const excludeEnd = Math.min(nSamples, maxTestIdx + 1 + purgeWindow + embargoWindow);

    // Training indices = all non-test groups, minus the exclusion zone
    const trainIndices: number[] = [];
    for (let g = 0; g < groupBoundaries.length; g++) {
      if (testGroupSet.has(g)) continue;
      const { start, end } = groupBoundaries[g];
      for (let i = start; i < end; i++) {
        if (i < excludeStart || i >= excludeEnd) {
          trainIndices.push(i);
        }
      }
    }

    return { trainIndices, testIndices };
  }
}
