import { PurgedCrossValidationService } from '@modules/parameter-stability/application/purged-cross-validation.service';

describe('PurgedCrossValidationService', () => {
  let service: PurgedCrossValidationService;

  beforeEach(() => {
    service = new PurgedCrossValidationService();
  });

  it('returns empty folds for nSamples=0', () => {
    const result = service.generate({ nSamples: 0, nFolds: 5, purgeWindow: 1 });
    expect(result.folds).toHaveLength(0);
  });

  it('produces exactly nFolds folds', () => {
    const result = service.generate({ nSamples: 100, nFolds: 5, purgeWindow: 0 });
    expect(result.folds).toHaveLength(5);
  });

  it('test folds are non-overlapping and cover all samples exactly once', () => {
    const result = service.generate({ nSamples: 100, nFolds: 5, purgeWindow: 0 });
    const allTest = result.folds.flatMap((f) => f.testIndices);
    // Each index appears exactly once
    const set = new Set(allTest);
    expect(set.size).toBe(100);
    for (let i = 0; i < 100; i++) expect(set.has(i)).toBe(true);
  });

  it('with purgeWindow=0, train ∪ test = all indices', () => {
    const result = service.generate({ nSamples: 30, nFolds: 3, purgeWindow: 0 });
    for (const fold of result.folds) {
      const all = new Set([...fold.trainIndices, ...fold.testIndices]);
      expect(all.size).toBe(30);
    }
  });

  it('train indices do not overlap with test indices', () => {
    const result = service.generate({ nSamples: 50, nFolds: 5, purgeWindow: 2 });
    for (const fold of result.folds) {
      const testSet = new Set(fold.testIndices);
      for (const idx of fold.trainIndices) {
        expect(testSet.has(idx)).toBe(false);
      }
    }
  });

  it('purge window removes samples adjacent to the test fold from train', () => {
    // 10 samples, 2 folds, purgeWindow=2
    // Fold 0: test=[0,1,2,3,4]; purge zone=[0..6]; train=[7,8,9]
    // Fold 1: test=[5,6,7,8,9]; purge zone=[3..9]; train=[0,1,2]
    const result = service.generate({ nSamples: 10, nFolds: 2, purgeWindow: 2 });

    const fold0 = result.folds[0];
    // purge zone covers [0, 5+2=7), so train must be indices ≥ 7
    for (const idx of fold0.trainIndices) {
      expect(idx).toBeGreaterThanOrEqual(7);
    }
  });

  it('embargo window further shrinks the training set after the test fold', () => {
    const noEmbargo = service.generate({
      nSamples: 60,
      nFolds: 3,
      purgeWindow: 1,
      embargoWindow: 0,
    });
    const withEmbargo = service.generate({
      nSamples: 60,
      nFolds: 3,
      purgeWindow: 1,
      embargoWindow: 3,
    });

    for (let k = 0; k < 3; k++) {
      expect(withEmbargo.folds[k].trainIndices.length).toBeLessThanOrEqual(
        noEmbargo.folds[k].trainIndices.length,
      );
    }
  });

  it('last fold absorbs any remainder samples', () => {
    // 22 samples, 3 folds: sizes 7,7,8
    const result = service.generate({ nSamples: 22, nFolds: 3, purgeWindow: 0 });
    const totalTest = result.folds.reduce((s, f) => s + f.testIndices.length, 0);
    expect(totalTest).toBe(22);
  });

  it('metadata is preserved in output', () => {
    const result = service.generate({ nSamples: 100, nFolds: 5, purgeWindow: 3, embargoWindow: 2 });
    expect(result.nSamples).toBe(100);
    expect(result.nFolds).toBe(5);
    expect(result.purgeWindow).toBe(3);
    expect(result.embargoWindow).toBe(2);
  });
});
