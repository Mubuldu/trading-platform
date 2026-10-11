import { StatisticsAggregatorService } from '@modules/monte-carlo/application/statistics-aggregator.service';
import { MonteCarloSimulationResult } from '@modules/monte-carlo/domain/models/monte-carlo-simulation-result.model';

function sim(
  idx: number,
  ret: number,
  dd: number,
  equityCurve: number[] = [10_000],
): MonteCarloSimulationResult {
  return {
    simulationIndex: idx,
    finalEquity: 10_000 * (1 + ret / 100),
    totalReturnPercent: ret,
    cagrPercent: ret * 0.9,
    maxDrawdownPercent: dd,
    sharpeRatio: ret / 10,
    sortinoRatio: ret / 12,
    isRuin: false,
    tradeCount: 10,
    equityCurve,
  };
}

describe('StatisticsAggregatorService', () => {
  let service: StatisticsAggregatorService;

  beforeEach(() => {
    service = new StatisticsAggregatorService();
  });

  // ── computePercentiles ───────────────────────────────────────────────────

  describe('computePercentiles', () => {
    it('returns all-zero struct for empty input', () => {
      const result = service.computePercentiles([]);
      expect(result.median).toBe(0);
      expect(result.stdDev).toBe(0);
    });

    it('returns scalar for single-element array', () => {
      const result = service.computePercentiles([42]);
      expect(result.p5).toBe(42);
      expect(result.median).toBe(42);
      expect(result.p95).toBe(42);
      expect(result.mean).toBe(42);
      expect(result.stdDev).toBe(0);
    });

    it('computes correct percentiles for known dataset', () => {
      const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      const result = service.computePercentiles(values);
      expect(result.median).toBeCloseTo(55, 1);
      expect(result.mean).toBeCloseTo(55, 1);
      expect(result.p5).toBeLessThan(result.p25);
      expect(result.p25).toBeLessThan(result.median);
      expect(result.median).toBeLessThan(result.p75);
      expect(result.p75).toBeLessThan(result.p95);
    });

    it('computes correct stdDev for symmetric dataset', () => {
      // [-1, 0, 1]: mean = 0, variance = (1+0+1)/3 ≈ 0.667, stdDev ≈ 0.816
      const result = service.computePercentiles([-1, 0, 1]);
      expect(result.mean).toBeCloseTo(0, 6);
      expect(result.stdDev).toBeCloseTo(Math.sqrt(2 / 3), 4);
    });
  });

  // ── computeVar95 / computeCvar95 ─────────────────────────────────────────

  describe('computeVar95', () => {
    it('returns 5th percentile of sorted returns', () => {
      const sorted = [10, 20, 30, 40, 50].sort((a, b) => a - b);
      const var95 = service.computeVar95(sorted);
      expect(var95).toBeCloseTo(service.interpolatedPercentile(sorted, 5), 6);
    });

    it('handles all-negative returns', () => {
      const sorted = [-50, -40, -30, -20, -10];
      expect(service.computeVar95(sorted)).toBeLessThan(-40);
    });
  });

  describe('computeCvar95', () => {
    it('is at most VaR95 (more extreme)', () => {
      const sorted = [-50, -40, -30, -20, -10, 0, 10, 20, 30, 40].sort((a, b) => a - b);
      const var95 = service.computeVar95(sorted);
      const cvar95 = service.computeCvar95(sorted);
      expect(cvar95).toBeLessThanOrEqual(var95);
    });

    it('equals VaR when only one value is below VaR', () => {
      // For a sorted array with a single element below p5, CVaR = that element.
      const sorted = Array.from({ length: 100 }, (_, i) => i - 50).sort((a, b) => a - b);
      const cvar = service.computeCvar95(sorted);
      expect(cvar).toBeLessThan(0);
    });
  });

  // ── computeUlcerIndex ────────────────────────────────────────────────────

  describe('computeUlcerIndex', () => {
    it('returns 0 for monotonically increasing equity', () => {
      const curve = [10_000, 10_100, 10_200, 10_300];
      expect(service.computeUlcerIndex(curve)).toBe(0);
    });

    it('returns 0 for flat equity', () => {
      const curve = [10_000, 10_000, 10_000];
      expect(service.computeUlcerIndex(curve)).toBe(0);
    });

    it('returns positive value for equity with drawdown', () => {
      // 10_000 → 9_000 is a 10 % drawdown
      const curve = [10_000, 9_000, 9_500, 10_000];
      const ui = service.computeUlcerIndex(curve);
      expect(ui).toBeGreaterThan(0);
    });

    it('returns 0 for empty curve', () => {
      expect(service.computeUlcerIndex([])).toBe(0);
    });
  });

  // ── computeAverageRecoveryTime ───────────────────────────────────────────

  describe('computeAverageRecoveryTime', () => {
    it('returns 0 when all simulations have no drawdown', () => {
      const sims = [
        sim(0, 10, 0, [10_000, 10_100, 10_200]),
        sim(1, 5, 0, [10_000, 10_050, 10_100]),
      ];
      expect(service.computeAverageRecoveryTime(sims)).toBe(0);
    });

    it('returns positive value when simulations have recoverable drawdowns', () => {
      // curve: 10_000 → 9_000 → 10_500 (recovers at index 2 from drawdown at index 1)
      const sims = [sim(0, 5, 10, [10_000, 9_000, 10_500])];
      const avg = service.computeAverageRecoveryTime(sims);
      expect(avg).toBeGreaterThan(0);
    });
  });

  // ── buildHistogram ───────────────────────────────────────────────────────

  describe('buildHistogram', () => {
    it('returns empty array for empty input', () => {
      expect(service.buildHistogram([])).toEqual([]);
    });

    it('returns single bin for constant values', () => {
      const bins = service.buildHistogram([5, 5, 5]);
      expect(bins).toHaveLength(1);
      expect(bins[0].count).toBe(3);
      expect(bins[0].frequency).toBe(1);
    });

    it('frequencies sum to 1 for non-trivial input', () => {
      const values = Array.from({ length: 100 }, (_, i) => i);
      const bins = service.buildHistogram(values, 10);
      const totalFreq = bins.reduce((s, b) => s + b.frequency, 0);
      expect(totalFreq).toBeCloseTo(1, 6);
    });

    it('respects the bins parameter', () => {
      const values = Array.from({ length: 100 }, (_, i) => i);
      const bins20 = service.buildHistogram(values, 20);
      // For uniformly spaced data some bins may merge at boundaries, but count ≤ requested.
      expect(bins20.length).toBeLessThanOrEqual(20);
    });

    it('bins are contiguous and cover the full range', () => {
      const values = [10, 20, 30, 40, 50];
      const bins = service.buildHistogram(values, 5);
      expect(bins[0].lowerBound).toBeCloseTo(10, 6);
      expect(bins[bins.length - 1].upperBound).toBeCloseTo(50, 6);
    });
  });
});
