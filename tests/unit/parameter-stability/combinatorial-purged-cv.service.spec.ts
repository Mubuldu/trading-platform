import { CombinatorialPurgedCvService } from '@modules/parameter-stability/application/combinatorial-purged-cv.service';

/** C(n, k) */
function choose(n: number, k: number): number {
  if (k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return Math.round(result);
}

describe('CombinatorialPurgedCvService', () => {
  let service: CombinatorialPurgedCvService;

  beforeEach(() => {
    service = new CombinatorialPurgedCvService();
  });

  it('returns empty folds for invalid config (nTestGroups ≥ nGroups)', () => {
    const result = service.generate({ nSamples: 100, nGroups: 5, nTestGroups: 5, purgeWindow: 0 });
    expect(result.folds).toHaveLength(0);
    expect(result.nCombinations).toBe(0);
  });

  it('produces exactly C(N, k) folds for N=6, k=2', () => {
    const result = service.generate({ nSamples: 120, nGroups: 6, nTestGroups: 2, purgeWindow: 0 });
    expect(result.folds).toHaveLength(15);
    expect(result.nCombinations).toBe(15);
  });

  it('produces exactly C(N, k) folds for N=5, k=3', () => {
    const result = service.generate({ nSamples: 100, nGroups: 5, nTestGroups: 3, purgeWindow: 0 });
    expect(result.folds).toHaveLength(choose(5, 3));
  });

  it('test indices of each fold cover exactly nTestGroups groups', () => {
    const nSamples = 60;
    const nGroups = 6;
    const nTestGroups = 2;
    const result = service.generate({ nSamples, nGroups, nTestGroups, purgeWindow: 0 });
    const groupSize = nSamples / nGroups; // = 10

    for (const fold of result.folds) {
      expect(fold.testGroups).toHaveLength(nTestGroups);
      // Each test group contributes groupSize indices
      expect(fold.testIndices.length).toBeGreaterThanOrEqual(nTestGroups * groupSize - 1);
    }
  });

  it('train and test indices are non-overlapping', () => {
    const result = service.generate({ nSamples: 60, nGroups: 6, nTestGroups: 2, purgeWindow: 0 });
    for (const fold of result.folds) {
      const testSet = new Set(fold.testIndices);
      for (const idx of fold.trainIndices) {
        expect(testSet.has(idx)).toBe(false);
      }
    }
  });

  it('all test-group combinations are unique', () => {
    const result = service.generate({ nSamples: 60, nGroups: 6, nTestGroups: 2, purgeWindow: 0 });
    const keys = result.folds.map((f) => f.testGroups.join(','));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('purge window reduces training-set size', () => {
    const base = service.generate({ nSamples: 60, nGroups: 6, nTestGroups: 2, purgeWindow: 0 });
    const purged = service.generate({ nSamples: 60, nGroups: 6, nTestGroups: 2, purgeWindow: 3 });

    for (let i = 0; i < base.folds.length; i++) {
      expect(purged.folds[i].trainIndices.length).toBeLessThanOrEqual(
        base.folds[i].trainIndices.length,
      );
    }
  });

  it('metadata is preserved in output', () => {
    const result = service.generate({
      nSamples: 120,
      nGroups: 6,
      nTestGroups: 2,
      purgeWindow: 2,
      embargoWindow: 1,
    });
    expect(result.nSamples).toBe(120);
    expect(result.nGroups).toBe(6);
    expect(result.nTestGroups).toBe(2);
    expect(result.purgeWindow).toBe(2);
    expect(result.embargoWindow).toBe(1);
  });

  it('standard CPCV (N=6, k=2): all N observations appear in test at least once', () => {
    const nSamples = 60;
    const result = service.generate({ nSamples, nGroups: 6, nTestGroups: 2, purgeWindow: 0 });
    const allTested = new Set<number>();
    for (const fold of result.folds) {
      fold.testIndices.forEach((i) => allTested.add(i));
    }
    // Every index [0, nSamples) appears as test at least once
    for (let i = 0; i < nSamples; i++) {
      expect(allTested.has(i)).toBe(true);
    }
  });
});
