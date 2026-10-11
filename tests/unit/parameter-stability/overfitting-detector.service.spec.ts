import { DeflatedSharpeService } from '@modules/parameter-stability/application/deflated-sharpe.service';
import { HeatmapGeneratorService } from '@modules/parameter-stability/application/heatmap-generator.service';
import { OverfittingDetectorService } from '@modules/parameter-stability/application/overfitting-detector.service';
import { ParameterRegionDetectorService } from '@modules/parameter-stability/application/parameter-region-detector.service';
import { ProbabilisticSharpeService } from '@modules/parameter-stability/application/probabilistic-sharpe.service';
import { SensitivityAnalyzerService } from '@modules/parameter-stability/application/sensitivity-analyzer.service';
import { StrategyHealthScorerService } from '@modules/parameter-stability/application/strategy-health-scorer.service';
import { SweepResultEntry } from '@modules/parameter-stability/domain/models/sweep-result.model';

function entry(params: Record<string, number>, sharpe: number): SweepResultEntry {
  return {
    params,
    metrics: { sharpe, netProfitPercent: sharpe * 10, maxDrawdownPercent: 10, winRate: 0.5 },
  };
}

function makeService(): OverfittingDetectorService {
  const psr = new ProbabilisticSharpeService();
  return new OverfittingDetectorService(
    new SensitivityAnalyzerService(),
    new HeatmapGeneratorService(),
    psr,
    new DeflatedSharpeService(psr),
    new ParameterRegionDetectorService(),
    new StrategyHealthScorerService(),
  );
}

/** Deterministic normal-ish returns using Box-Muller + LCG. */
function returns(n: number, mu: number, sigma: number, seed = 1): number[] {
  let s = seed;
  const lcg = () => {
    s = Math.imul(s, 1664525) + 1013904223;
    return (s >>> 0) / 0x100000000;
  };
  const out: number[] = [];
  while (out.length < n) {
    const u1 = Math.max(lcg(), 1e-15);
    const u2 = lcg();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const z1 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
    out.push(mu + sigma * z0);
    if (out.length < n) out.push(mu + sigma * z1);
  }
  return out.slice(0, n);
}

describe('OverfittingDetectorService', () => {
  let service: OverfittingDetectorService;

  beforeEach(() => {
    service = makeService();
  });

  // ── Stable parameters scenario ─────────────────────────────────────────────
  describe('stable parameters scenario', () => {
    it('does not flag as overfit when parameters are stable', () => {
      // Grid search with stable results: metric barely changes across params
      const sweepResults = [10, 20, 30, 40, 50].map((p) =>
        entry({ period: p }, 1.5 + (p - 30) * 0.001),
      );
      // High-SR returns with many observations
      const bestReturns = returns(1000, 0.003, 0.005, 42);

      const report = service.analyze({ sweepResults, bestReturns });

      expect(report.healthScore).toBeDefined();
      expect(report.deflatedSharpe).toBeDefined();
      expect(report.probabilisticSharpe).toBeDefined();
      // Should have low signal count given stable params and strong returns
      expect(report.signalCount).toBeLessThanOrEqual(2);
    });
  });

  // ── Overfit parameters scenario ────────────────────────────────────────────
  describe('overfit parameters scenario', () => {
    it('detects overfitting with many trials and weak returns', () => {
      // 100 random sweep results with noise Sharpes, few observations in best
      const sweepResults = Array.from({ length: 100 }, (_, i) =>
        entry({ period: 10 + i, mult: 1 + (i % 5) * 0.3 }, Math.random() * 0.5 - 0.1),
      );
      sweepResults.push(entry({ period: 55, mult: 2.5 }, 1.2)); // best by luck

      const bestReturns = returns(30, 0.0005, 0.02, 99); // very few observations

      const report = service.analyze({ sweepResults, bestReturns });

      // With many trials and few observations, signals should fire
      expect(report.signalCount).toBeGreaterThanOrEqual(1);
      expect(report.warnings.length).toBeGreaterThan(0);
    });
  });

  // ── Random parameters scenario ─────────────────────────────────────────────
  describe('random parameters scenario', () => {
    it('returns a complete report regardless of parameter values', () => {
      // Completely random metrics
      const sweepResults = Array.from({ length: 20 }, () =>
        entry({ a: Math.random() * 10, b: Math.random() * 5 }, Math.random() * 2 - 1),
      );
      const bestReturns = returns(100, 0.001, 0.01, 7);

      const report = service.analyze({ sweepResults, bestReturns });

      // Report structure must always be complete
      expect(report.isOverfit).toBeDefined();
      expect(report.signalCount).toBeGreaterThanOrEqual(0);
      expect(report.signalCount).toBeLessThanOrEqual(5);
      expect(report.healthScore.grade).toBeDefined();
      expect(report.warnings).toBeInstanceOf(Array);
      expect(report.recommendations).toBeInstanceOf(Array);
      expect(report.heatmapSets.length).toBeGreaterThan(0); // 2 params → 1 set
      expect(report.parameterRegions.regions).toHaveLength(2);
    });
  });

  // ── Structural assertions ──────────────────────────────────────────────────
  it('heatmapSets is empty when only one parameter', () => {
    const sweepResults = [10, 20, 30].map((p) => entry({ period: p }, 1.0));
    const report = service.analyze({ sweepResults, bestReturns: returns(100, 0.001, 0.01) });
    expect(report.heatmapSets).toHaveLength(0);
  });

  it('recommendations are non-empty', () => {
    const sweepResults = [entry({ period: 10 }, 0.5), entry({ period: 20 }, 0.6)];
    const report = service.analyze({ sweepResults, bestReturns: returns(50, 0.0005, 0.01) });
    expect(report.recommendations.length).toBeGreaterThan(0);
  });

  it('isOverfit matches signalCount >= 2', () => {
    const sweepResults = [entry({ period: 10 }, 0.1), entry({ period: 20 }, 0.2)];
    const report = service.analyze({ sweepResults, bestReturns: returns(20, 0.0001, 0.01) });
    expect(report.isOverfit).toBe(report.signalCount >= 2);
  });
});
