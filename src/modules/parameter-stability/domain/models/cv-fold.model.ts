/**
 * A single train/test split produced by Purged Cross-Validation.
 *
 * Indices refer to positions in the original time-ordered observation array.
 * The "purge window" has already been removed from the training set so that
 * no training sample has a label that overlaps with the test period.
 */
export interface CvFold {
  /** Zero-based fold index within the overall split. */
  readonly foldIndex: number;
  /** Sorted indices of training observations (gaps already purged). */
  readonly trainIndices: number[];
  /** Sorted indices of test observations. */
  readonly testIndices: number[];
}

/** Output of PurgedCrossValidationService.generate(). */
export interface PurgedCvFolds {
  readonly folds: CvFold[];
  readonly nFolds: number;
  readonly nSamples: number;
  /** Number of samples purged on each side of each test fold. */
  readonly purgeWindow: number;
  /** Additional samples embargoed after each test fold (0 if not set). */
  readonly embargoWindow: number;
}

/**
 * A single train/test split produced by Combinatorial Purged Cross-Validation.
 *
 * Rather than one group at a time, CPCV tests all C(N, k) combinations of k
 * groups simultaneously, producing many more OOS paths for a more robust
 * statistical estimate of out-of-sample performance.
 */
export interface CpcvFold {
  /** Indices (into the N-group array) of groups used as test. */
  readonly testGroups: number[];
  /** Sorted observation indices of the combined test groups (purge applied). */
  readonly trainIndices: number[];
  /** Sorted observation indices of the combined training groups. */
  readonly testIndices: number[];
}

/** Output of CombinatorialPurgedCvService.generate(). */
export interface CpcvFolds {
  readonly folds: CpcvFold[];
  /** C(nGroups, nTestGroups). */
  readonly nCombinations: number;
  readonly nGroups: number;
  readonly nTestGroups: number;
  readonly nSamples: number;
  readonly purgeWindow: number;
  readonly embargoWindow: number;
}
