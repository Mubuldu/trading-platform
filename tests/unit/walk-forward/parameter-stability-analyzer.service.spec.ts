import { ParameterStabilityAnalyzerService } from '@modules/walk-forward/application/parameter-stability-analyzer.service';
import { WalkForwardWindowResult } from '@modules/walk-forward/domain/models/walk-forward-window-result.model';

function makeWindow(params: Record<string, number>, index = 0): WalkForwardWindowResult {
  return {
    window: {
      index,
      trainStartTime: 0,
      trainEndTime: 1000,
      testStartTime: 1000,
      testEndTime: 2000,
    },
    bestParams: params,
    bestTrainMetricValue: 1,
    trainResult: {} as any,
    testResult: {} as any,
    allCandidates: [],
    performanceDecayRatio: 0.8,
  };
}

describe('ParameterStabilityAnalyzerService', () => {
  let service: ParameterStabilityAnalyzerService;

  beforeEach(() => {
    service = new ParameterStabilityAnalyzerService();
  });

  it('returns empty report for zero windows', () => {
    const report = service.analyze([]);
    expect(report.parameters).toEqual({});
    expect(report.overallStabilityScore).toBe(0);
  });

  it('CV = 0 and isStable=true when all windows pick the same value', () => {
    const windows = [
      makeWindow({ period: 20 }, 0),
      makeWindow({ period: 20 }, 1),
      makeWindow({ period: 20 }, 2),
      makeWindow({ period: 20 }, 3),
    ];
    const report = service.analyze(windows);
    const p = report.parameters['period'];
    expect(p.coefficientOfVariation).toBe(0);
    expect(p.isStable).toBe(true);
    expect(p.isSensitive).toBe(false);
    expect(p.isFragile).toBe(false);
    expect(report.overallStabilityScore).toBe(1);
  });

  it('computes correct mean', () => {
    const windows = [
      makeWindow({ period: 10 }, 0),
      makeWindow({ period: 20 }, 1),
      makeWindow({ period: 30 }, 2),
    ];
    const report = service.analyze(windows);
    expect(report.parameters['period'].mean).toBeCloseTo(20);
  });

  it('computes correct stdDev', () => {
    // values [10, 20, 30]: mean=20, variance=((10-20)^2 + (20-20)^2 + (30-20)^2)/3 = 200/3, stdDev≈8.165
    const windows = [
      makeWindow({ period: 10 }, 0),
      makeWindow({ period: 20 }, 1),
      makeWindow({ period: 30 }, 2),
    ];
    const report = service.analyze(windows);
    expect(report.parameters['period'].stdDev).toBeCloseTo(Math.sqrt(200 / 3));
  });

  it('classifies isSensitive for CV in [0.3, 0.5)', () => {
    // Need CV around 0.4: values with mean=100, stdDev≈40 → values [60, 140]
    // CV = 40/100 = 0.4
    const windows = [makeWindow({ period: 60 }, 0), makeWindow({ period: 140 }, 1)];
    const report = service.analyze(windows);
    const p = report.parameters['period'];
    // stdDev for [60,140]: mean=100, variance=((60-100)^2+(140-100)^2)/2 = (1600+1600)/2=1600, stdDev=40
    expect(p.coefficientOfVariation).toBeCloseTo(0.4);
    expect(p.isSensitive).toBe(true);
    expect(p.isStable).toBe(false);
    expect(p.isFragile).toBe(false);
  });

  it('classifies isFragile for CV >= 0.5', () => {
    // Values [10, 90]: mean=50, variance=((10-50)^2+(90-50)^2)/2=1600, stdDev=40, CV=40/50=0.8
    const windows = [makeWindow({ period: 10 }, 0), makeWindow({ period: 90 }, 1)];
    const report = service.analyze(windows);
    const p = report.parameters['period'];
    expect(p.coefficientOfVariation).toBeCloseTo(0.8);
    expect(p.isFragile).toBe(true);
    expect(p.isSensitive).toBe(false);
    expect(p.isStable).toBe(false);
  });

  it('handles multiple parameters independently', () => {
    const windows = [
      makeWindow({ stablePeriod: 20, fragileMultiplier: 10 }, 0),
      makeWindow({ stablePeriod: 20, fragileMultiplier: 90 }, 1),
    ];
    const report = service.analyze(windows);
    expect(report.parameters['stablePeriod'].isStable).toBe(true);
    expect(report.parameters['fragileMultiplier'].isFragile).toBe(true);
  });

  it('overallStabilityScore equals fraction of stable parameters', () => {
    const windows = [
      makeWindow({ stable1: 20, stable2: 50, fragile: 10 }, 0),
      makeWindow({ stable1: 20, stable2: 50, fragile: 90 }, 1),
    ];
    const report = service.analyze(windows);
    // stable1 and stable2 are stable, fragile is not → 2/3
    expect(report.overallStabilityScore).toBeCloseTo(2 / 3);
  });

  it('records all selected values per param', () => {
    const windows = [
      makeWindow({ period: 10 }, 0),
      makeWindow({ period: 20 }, 1),
      makeWindow({ period: 30 }, 2),
    ];
    const report = service.analyze(windows);
    expect(report.parameters['period'].values).toEqual([10, 20, 30]);
  });
});
