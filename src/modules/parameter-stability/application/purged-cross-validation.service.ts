import { Injectable } from '@nestjs/common';
import { CvFold, PurgedCvFolds } from '../domain/models/cv-fold.model';

export interface PurgedCvConfig {
  /** Total number of time-ordered observations. */
  readonly nSamples: number;
  /** Number of folds K (test periods). */
  readonly nFolds: number;
  /**
   * Number of samples to purge on either side of each test fold.
   * Purging prevents look-ahead bias when features use a rolling window
   * that extends into the test period.
   */
  readonly purgeWindow: number;
  /**
   * Optional embargo: additional samples removed from the training set
   * immediately AFTER the test fold (e.g. to prevent leakage from
   * label-generation pipelines that look slightly forward in time).
   */
  readonly embargoWindow?: number;
}

/**
 * PurgedCrossValidationService
 *
 * Produces K purged-and-embargoed train/test splits for a time-ordered
 * observation array.
 *
 * Standard K-Fold splits data into K equal groups and rotates the test fold.
 * Purged K-Fold additionally removes:
 *   – `purgeWindow` samples immediately before the test fold (purge-before):
 *     prevents a rolling feature computed at time t–1 from "seeing" labels
 *     assigned at time t (the first test sample).
 *   – `purgeWindow` samples immediately after the test fold (purge-after):
 *     prevents labels overlapping if each label spans more than one period.
 *   – `embargoWindow` samples after the purge-after zone:
 *     extra safety margin for more complex label structures.
 *
 * This method is described in Lopez de Prado (2018), "Advances in Financial
 * Machine Learning", Chapter 7.
 */
@Injectable()
export class PurgedCrossValidationService {
  generate(config: PurgedCvConfig): PurgedCvFolds {
    const { nSamples, nFolds, purgeWindow, embargoWindow = 0 } = config;

    if (nSamples <= 0 || nFolds <= 0) {
      return { folds: [], nFolds, nSamples, purgeWindow, embargoWindow };
    }

    const foldSize = Math.floor(nSamples / nFolds);
    const folds: CvFold[] = [];

    for (let k = 0; k < nFolds; k++) {
      const testStart = k * foldSize;
      const testEnd = k === nFolds - 1 ? nSamples : testStart + foldSize; // last fold absorbs remainder

      const testIndices = this.range(testStart, testEnd);

      // Exclusion zone: purge-before + test + purge-after + embargo
      const excludeStart = Math.max(0, testStart - purgeWindow);
      const excludeEnd = Math.min(nSamples, testEnd + purgeWindow + embargoWindow);

      const trainIndices = [...this.range(0, excludeStart), ...this.range(excludeEnd, nSamples)];

      folds.push({ foldIndex: k, trainIndices, testIndices });
    }

    return { folds, nFolds, nSamples, purgeWindow, embargoWindow };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /** Returns [start, start+1, …, end-1]. */
  private range(start: number, end: number): number[] {
    const arr: number[] = [];
    for (let i = start; i < end; i++) arr.push(i);
    return arr;
  }
}
