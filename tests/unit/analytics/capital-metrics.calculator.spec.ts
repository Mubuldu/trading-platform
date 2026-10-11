import {
  CapitalMetricsCalculator,
  DailyCapitalRecord,
} from '@modules/analytics/application/calculators/capital-metrics.calculator';

describe('CapitalMetricsCalculator', () => {
  let calculator: CapitalMetricsCalculator;

  const BASE_TS = 1_700_000_000_000;
  const DAY = 86_400_000;

  beforeEach(() => {
    calculator = new CapitalMetricsCalculator();
  });

  const makeRecord = (
    dayIndex: number,
    equity: number,
    cashBalance?: number,
    unrealizedPnl = 0,
  ): DailyCapitalRecord => ({
    date: new Date(BASE_TS + dayIndex * DAY).toISOString().slice(0, 10),
    timestamp: BASE_TS + dayIndex * DAY,
    equity,
    cashBalance: cashBalance ?? equity,
    unrealizedPnl,
  });

  // ── Empty input ──────────────────────────────────────────────────────────────

  describe('with no daily records', () => {
    it('returns empty curves and current snapshot values', () => {
      const result = calculator.compute([], 10_000, 10_000, 10_000);
      expect(result.equityCurve).toHaveLength(0);
      expect(result.balanceCurve).toHaveLength(0);
      expect(result.currentEquity).toBe(10_000);
      expect(result.currentBalance).toBe(10_000);
    });

    it('computes buyingPower = currentBalance - marginUsed', () => {
      const result = calculator.compute([], 10_000, 8_000, 10_000, 0, 2_000);
      expect(result.buyingPower).toBe(6_000); // 8000 - 2000
    });
  });

  // ── Equity curve construction ────────────────────────────────────────────────

  describe('equity curve', () => {
    it('populates one point per daily record in chronological order', () => {
      const records = [makeRecord(0, 10_000), makeRecord(1, 10_200), makeRecord(2, 10_500)];
      const result = calculator.compute(records, 10_500, 10_500, 10_000);
      expect(result.equityCurve).toHaveLength(3);
      expect(result.equityCurve[0]!.equity).toBe(10_000);
      expect(result.equityCurve[1]!.equity).toBe(10_200);
      expect(result.equityCurve[2]!.equity).toBe(10_500);
    });

    it('sorts records by timestamp even if provided out of order', () => {
      const records = [makeRecord(2, 10_500), makeRecord(0, 10_000), makeRecord(1, 10_200)];
      const result = calculator.compute(records, 10_500, 10_500, 10_000);
      expect(result.equityCurve[0]!.equity).toBe(10_000);
      expect(result.equityCurve[1]!.equity).toBe(10_200);
      expect(result.equityCurve[2]!.equity).toBe(10_500);
    });

    it('computes dailyReturn for each point', () => {
      const records = [
        makeRecord(0, 10_000),
        makeRecord(1, 10_200), // +2%
        makeRecord(2, 10_100), // -0.98%
      ];
      const result = calculator.compute(records, 10_100, 10_100, 10_000);
      // First point: prev = initialCapital = 10000, (10000-10000)/10000 = 0
      expect(result.equityCurve[0]!.dailyReturn).toBeCloseTo(0);
      // Second point: (10200 - 10000) / 10000 = 0.02
      expect(result.equityCurve[1]!.dailyReturn).toBeCloseTo(0.02);
      // Third point: (10100 - 10200) / 10200 ≈ -0.0098
      expect(result.equityCurve[2]!.dailyReturn).toBeCloseTo(-100 / 10_200);
    });

    it('computes cumulativeReturn from start of period', () => {
      const records = [
        makeRecord(0, 10_000),
        makeRecord(1, 11_000), // +10%
        makeRecord(2, 12_000), // +20% from start
      ];
      const result = calculator.compute(records, 12_000, 12_000, 10_000);
      // cumulative from first record equity (10000)
      expect(result.equityCurve[2]!.cumulativeReturn).toBeCloseTo(0.2);
    });
  });

  // ── Drawdown percent ─────────────────────────────────────────────────────────

  describe('drawdownPercent', () => {
    it('is 0 for all points when equity is monotonically increasing', () => {
      const records = [makeRecord(0, 10_000), makeRecord(1, 10_500), makeRecord(2, 11_000)];
      const result = calculator.compute(records, 11_000, 11_000, 10_000);
      for (const point of result.equityCurve) {
        expect(point.drawdownPercent).toBeCloseTo(0);
      }
    });

    it('computes drawdownPercent correctly after a peak', () => {
      // peak = 12000, then falls to 9000 → dd = (12000-9000)/12000 = 0.25
      const records = [
        makeRecord(0, 10_000),
        makeRecord(1, 12_000), // new peak
        makeRecord(2, 9_000), // drawdown from peak
      ];
      const result = calculator.compute(records, 9_000, 9_000, 10_000);
      expect(result.equityCurve[2]!.drawdownPercent).toBeCloseTo(0.25, 4);
    });

    it('resets drawdown when equity recovers above peak', () => {
      const records = [
        makeRecord(0, 10_000),
        makeRecord(1, 8_000), // drawdown from initial
        makeRecord(2, 11_000), // new peak → dd = 0
      ];
      const result = calculator.compute(records, 11_000, 11_000, 10_000);
      expect(result.equityCurve[2]!.drawdownPercent).toBeCloseTo(0);
    });
  });

  // ── Balance curve ────────────────────────────────────────────────────────────

  it('builds balanceCurve from cashBalance values', () => {
    const records = [
      makeRecord(0, 10_000, 8_000), // 2000 in positions
      makeRecord(1, 10_500, 7_500), // 3000 in positions
    ];
    const result = calculator.compute(records, 10_500, 7_500, 10_000);
    expect(result.balanceCurve[0]!.equity).toBe(8_000);
    expect(result.balanceCurve[1]!.equity).toBe(7_500);
  });

  // ── Margin and leverage metrics ──────────────────────────────────────────────

  describe('margin and leverage', () => {
    it('computes marginUtilizationPercent = marginUsed / currentEquity', () => {
      const result = calculator.compute([], 10_000, 10_000, 10_000, 0, 2_000);
      expect(result.marginUtilizationPercent).toBeCloseTo(0.2);
    });

    it('computes leverageUtilization = grossExposure / currentEquity', () => {
      const result = calculator.compute([], 10_000, 10_000, 10_000, 25_000);
      expect(result.leverageUtilization).toBeCloseTo(2.5);
    });

    it('computes buyingPower = max(currentBalance - marginUsed, 0)', () => {
      // marginUsed > currentBalance → clamped to 0
      const result = calculator.compute([], 10_000, 3_000, 10_000, 0, 5_000);
      expect(result.buyingPower).toBe(0);
    });
  });

  // ── Cash utilization ─────────────────────────────────────────────────────────

  describe('cashUtilizationPercent', () => {
    it('is 0 when all capital is in cash (balance = equity)', () => {
      const result = calculator.compute([], 10_000, 10_000, 10_000);
      expect(result.cashUtilizationPercent).toBeCloseTo(0);
    });

    it('is positive when capital is deployed in positions', () => {
      // equity = 10000, balance = 6000 → 4000 deployed → 40%
      const result = calculator.compute([], 10_000, 6_000, 10_000);
      expect(result.cashUtilizationPercent).toBeCloseTo(0.4);
    });

    it('is clamped to [0, 1]', () => {
      // Extreme edge: balance > equity (shouldn't happen, but guard)
      const result = calculator.compute([], 10_000, 15_000, 10_000);
      expect(result.cashUtilizationPercent).toBeGreaterThanOrEqual(0);
      expect(result.cashUtilizationPercent).toBeLessThanOrEqual(1);
    });
  });

  // ── Zero equity guard ────────────────────────────────────────────────────────

  it('handles zero current equity without throwing', () => {
    expect(() => calculator.compute([], 0, 0, 10_000)).not.toThrow();
    const result = calculator.compute([], 0, 0, 10_000);
    expect(result.marginUtilizationPercent).toBe(0);
    expect(result.leverageUtilization).toBe(0);
    expect(result.cashUtilizationPercent).toBe(0);
  });

  // ── Large dataset ────────────────────────────────────────────────────────────

  it('handles 365 daily records without errors', () => {
    const records = Array.from({ length: 365 }, (_, i) => {
      const equity = 10_000 * (1 + i * 0.001);
      return makeRecord(i, equity, equity * 0.5);
    });
    const result = calculator.compute(records, 13_650, 6_825, 10_000);
    expect(result.equityCurve).toHaveLength(365);
    expect(result.balanceCurve).toHaveLength(365);
  });
});
