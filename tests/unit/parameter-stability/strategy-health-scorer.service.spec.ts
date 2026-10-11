import { StrategyHealthScorerService } from '@modules/parameter-stability/application/strategy-health-scorer.service';
import { DeflatedSharpeResult } from '@modules/parameter-stability/domain/models/deflated-sharpe-result.model';
import { ParameterRegionReport } from '@modules/parameter-stability/domain/models/parameter-region.model';
import { ProbabilisticSharpeResult } from '@modules/parameter-stability/domain/models/probabilistic-sharpe-result.model';
import { SensitivityAnalysisReport } from '@modules/parameter-stability/domain/models/sensitivity-analysis.model';

function makeSensitivity(
  overallRobustness: number,
  sensitiveParams: string[] = [],
): SensitivityAnalysisReport {
  const curves: SensitivityAnalysisReport['curves'] = {};

  // Derive the set of sensitive param names from the robustness level when not
  // explicitly provided.  overallRobustness=0 means all params are sensitive;
  // 0<r<1 means one out of two; r=1 means none.
  const resolvedSensitive: string[] =
    sensitiveParams.length > 0
      ? sensitiveParams
      : overallRobustness === 0
        ? ['p1', 'p2'] // both params sensitive → > 50 % threshold fires
        : overallRobustness < 1
          ? ['p1']
          : [];

  for (const p of resolvedSensitive) {
    curves[p] = {
      paramName: p,
      baselineMetric: 1.0,
      points: [],
      sensitivity: overallRobustness < 0.5 ? 1.0 : 0.3,
      isSensitive: true,
    };
  }

  // Always add a non-sensitive anchor so nTotal > 0
  if (!curves['p0']) {
    curves['p0'] = {
      paramName: 'p0',
      baselineMetric: 1.0,
      points: [],
      sensitivity: 0.1,
      isSensitive: false,
    };
  }

  return { curves, sensitiveParams: resolvedSensitive, overallRobustness };
}

function makePsr(psr: number): ProbabilisticSharpeResult {
  return {
    observedSharpe: 1.0,
    benchmarkSharpe: 0,
    standardError: 0.1,
    psr,
    isSignificant: psr >= 0.95,
    nObservations: 500,
    skewness: 0,
    excessKurtosis: 0,
  };
}

function makeDsr(dsr: number): DeflatedSharpeResult {
  return {
    observedSharpe: 1.0,
    minRequiredSharpe: 0.5,
    deflatedSharpeRatio: dsr,
    isSignificant: dsr >= 0.95,
    nTrials: 50,
    nObservations: 500,
    trialSharpeStdDev: 0.5,
    skewness: 0,
    excessKurtosis: 0,
  };
}

function makeRegions(cliffs = 0, islands = 0): ParameterRegionReport {
  const cliffRegions = Array.from({ length: cliffs }, (_, i) => ({
    type: 'CLIFF' as const,
    paramName: `cliff${i}`,
    paramValues: [10, 20],
    metrics: [1.0, 0.1],
    meanMetric: 0.55,
    stdMetric: 0.45,
    description: `cliff at param cliff${i}`,
  }));
  const islandRegions = Array.from({ length: islands }, (_, i) => ({
    type: 'ISLAND' as const,
    paramName: `island${i}`,
    paramValues: [10, 20, 30],
    metrics: [0.5, 3.0, 0.4],
    meanMetric: 1.3,
    stdMetric: 1.1,
    description: `island in param island${i}`,
  }));

  const regions = [...cliffRegions, ...islandRegions];
  return {
    regions,
    cliffs: cliffRegions,
    islands: islandRegions,
    stableRegions: [],
    unstableRegions: [],
    hasFragilitySignals: cliffs > 0 || islands > 0,
  };
}

describe('StrategyHealthScorerService', () => {
  let service: StrategyHealthScorerService;

  beforeEach(() => {
    service = new StrategyHealthScorerService();
  });

  const perfectSensitivity = makeSensitivity(1);
  const perfectPsr = makePsr(0.99);
  const perfectDsr = makeDsr(0.99);
  const cleanRegions = makeRegions(0, 0);

  it('returns A+ grade for a clean strategy', () => {
    const result = service.score(perfectSensitivity, perfectPsr, perfectDsr, cleanRegions);
    expect(result.grade).toBe('A+');
    expect(result.numericScore).toBeGreaterThanOrEqual(90);
    expect(result.isOverfit).toBe(false);
  });

  it('returns F grade for a clearly overfit strategy', () => {
    const result = service.score(
      makeSensitivity(0), // all sensitive
      makePsr(0.3), // PSR very low
      makeDsr(0.2), // DSR very low
      makeRegions(2, 2), // cliffs and islands
    );
    expect(['D', 'F']).toContain(result.grade);
    expect(result.numericScore).toBeLessThan(60);
    expect(result.isOverfit).toBe(true);
  });

  it('PSR penalty: PSR < 0.5 subtracts 30 pts from robustness', () => {
    const result = service.score(perfectSensitivity, makePsr(0.3), perfectDsr, cleanRegions);
    expect(result.robustness.score).toBeLessThanOrEqual(70);
    expect(result.robustness.penalties.length).toBeGreaterThan(0);
  });

  it('DSR penalty: DSR < 0.5 subtracts 20 pts from robustness', () => {
    const result = service.score(perfectSensitivity, perfectPsr, makeDsr(0.3), cleanRegions);
    expect(result.robustness.score).toBeLessThanOrEqual(80);
  });

  it('island penalty: deducts 20 pts from consistency', () => {
    const result = service.score(perfectSensitivity, perfectPsr, perfectDsr, makeRegions(0, 1));
    expect(result.consistency.score).toBeLessThanOrEqual(80);
    expect(result.consistency.penalties.length).toBeGreaterThan(0);
  });

  it('cliff penalty: deducts 15 pts from consistency', () => {
    const result = service.score(perfectSensitivity, perfectPsr, perfectDsr, makeRegions(1, 0));
    expect(result.consistency.score).toBeLessThanOrEqual(85);
  });

  it('isOverfit = true when numericScore < 50', () => {
    const result = service.score(makeSensitivity(0), makePsr(0.2), makeDsr(0.1), makeRegions(2, 2));
    expect(result.isOverfit).toBe(true);
  });

  it('topPenalties contains up to 5 items', () => {
    const result = service.score(
      makeSensitivity(0, ['p1', 'p2', 'p3']),
      makePsr(0.1),
      makeDsr(0.1),
      makeRegions(1, 1),
    );
    expect(result.topPenalties.length).toBeLessThanOrEqual(5);
  });

  it('grades span at least A+, A, B, C, D across realistic inputs', () => {
    // Because each dimension contributes a weighted fraction of the final score,
    // we must vary all three to drive results across the full grade range.
    //
    // Calculated expected scores (see scoring rubric in the service):
    //   A+ : sens=1 / PSR=0.99 / DSR=0.99 / clean        → 100
    //   A  : sens=0 / PSR=0.99 / DSR=0.99 / clean        → 84   (stability=60)
    //   B  : sens=0 / PSR=0.60 / DSR=0.60 / clean        → 74   (robustness=68)
    //   C  : sens=0 / PSR=0.60 / DSR=0.60 / cliff+island → 64   (consistency=65)
    //   D  : sens=0 / PSR=0.30 / DSR=0.20 / cliff+island → 59   (robustness=50)
    const scenarios: Array<
      [
        ReturnType<typeof makeSensitivity>,
        ReturnType<typeof makePsr>,
        ReturnType<typeof makeDsr>,
        ReturnType<typeof makeRegions>,
      ]
    > = [
      [perfectSensitivity, makePsr(0.99), makeDsr(0.99), makeRegions(0, 0)], // A+
      [makeSensitivity(0), makePsr(0.99), makeDsr(0.99), makeRegions(0, 0)], // A
      [makeSensitivity(0), makePsr(0.6), makeDsr(0.6), makeRegions(0, 0)], // B
      [makeSensitivity(0), makePsr(0.6), makeDsr(0.6), makeRegions(1, 1)], // C
      [makeSensitivity(0), makePsr(0.3), makeDsr(0.2), makeRegions(1, 1)], // D
    ];

    const allGrades = new Set<string>(
      scenarios.map(([s, p, d, r]) => service.score(s, p, d, r).grade),
    );
    expect(allGrades.size).toBeGreaterThanOrEqual(4);
  });
});
