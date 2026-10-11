import { SensitivityAnalyzerService } from '@modules/parameter-stability/application/sensitivity-analyzer.service';
import { SweepResultEntry } from '@modules/parameter-stability/domain/models/sweep-result.model';

function makeEntry(params: Record<string, number>, sharpe: number): SweepResultEntry {
  return {
    params,
    metrics: { sharpe, netProfitPercent: sharpe * 10, maxDrawdownPercent: 10, winRate: 0.5 },
  };
}

describe('SensitivityAnalyzerService', () => {
  let service: SensitivityAnalyzerService;

  beforeEach(() => {
    service = new SensitivityAnalyzerService();
  });

  it('returns empty report for zero results', () => {
    const report = service.analyze([]);
    expect(report.curves).toEqual({});
    expect(report.sensitiveParams).toEqual([]);
    expect(report.overallRobustness).toBe(1);
  });

  it('returns sensitivity = 0 when all values produce the same metric', () => {
    const results = [
      makeEntry({ period: 10 }, 1.0),
      makeEntry({ period: 20 }, 1.0),
      makeEntry({ period: 30 }, 1.0),
    ];
    const report = service.analyze(results);
    expect(report.curves['period'].sensitivity).toBeCloseTo(0);
    expect(report.curves['period'].isSensitive).toBe(false);
  });

  it('classifies a parameter as sensitive when metric swings > 50 % of baseline', () => {
    // baseline (median mean) = 1.0, swing = 2.0 − 0.0 = 2.0 → sensitivity = 2.0
    const results = [
      makeEntry({ period: 10 }, 0.0),
      makeEntry({ period: 20 }, 1.0),
      makeEntry({ period: 30 }, 2.0),
    ];
    const report = service.analyze(results);
    expect(report.curves['period'].isSensitive).toBe(true);
    expect(report.sensitiveParams).toContain('period');
  });

  it('classifies a stable parameter correctly', () => {
    // Swing = 1.2 − 1.0 = 0.2; baseline ≈ 1.1; sensitivity ≈ 0.18
    const results = [
      makeEntry({ period: 10 }, 1.0),
      makeEntry({ period: 20 }, 1.1),
      makeEntry({ period: 30 }, 1.2),
    ];
    const report = service.analyze(results);
    expect(report.curves['period'].isSensitive).toBe(false);
  });

  it('builds marginal averaging correctly for a 2-param grid', () => {
    // period=10 appears with mult=1 (sharpe=0.5) and mult=2 (sharpe=1.5) → mean=1.0
    // period=20 appears with mult=1 (sharpe=1.5) and mult=2 (sharpe=2.5) → mean=2.0
    const results = [
      makeEntry({ period: 10, mult: 1 }, 0.5),
      makeEntry({ period: 10, mult: 2 }, 1.5),
      makeEntry({ period: 20, mult: 1 }, 1.5),
      makeEntry({ period: 20, mult: 2 }, 2.5),
    ];
    const report = service.analyze(results);
    const periodCurve = report.curves['period'];
    expect(periodCurve.points[0].meanMetric).toBeCloseTo(1.0); // period=10
    expect(periodCurve.points[1].meanMetric).toBeCloseTo(2.0); // period=20
  });

  it('overallRobustness = 1 when no params are sensitive', () => {
    const results = [makeEntry({ period: 10 }, 1.0), makeEntry({ period: 20 }, 1.05)];
    const report = service.analyze(results);
    expect(report.overallRobustness).toBe(1);
  });

  it('overallRobustness = 0 when all params are sensitive', () => {
    // Large swing → isSensitive = true
    const results = [makeEntry({ period: 10 }, -2.0), makeEntry({ period: 20 }, 2.0)];
    const report = service.analyze(results);
    expect(report.curves['period'].isSensitive).toBe(true);
    expect(report.overallRobustness).toBe(0);
  });

  it('points are sorted ascending by paramValue', () => {
    const results = [
      makeEntry({ period: 30 }, 1.0),
      makeEntry({ period: 10 }, 1.2),
      makeEntry({ period: 20 }, 0.8),
    ];
    const report = service.analyze(results);
    const vals = report.curves['period'].points.map((p) => p.paramValue);
    expect(vals).toEqual([10, 20, 30]);
  });
});
