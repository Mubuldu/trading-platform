import { RiskMetricsCalculator } from '@modules/analytics/application/calculators/risk-metrics.calculator';
import { AnalyticsEquityPoint } from '@modules/analytics/domain/models/analytics-trade.model';

describe('RiskMetricsCalculator', () => {
  let calculator: RiskMetricsCalculator;

  beforeEach(() => {
    calculator = new RiskMetricsCalculator();
  });

  // ── Equity point factory ────────────────────────────────────────────────────

  const makePoint = (
    dayIndex: number,
    equity: number,
    prevEquity?: number,
  ): AnalyticsEquityPoint => {
    const prev = prevEquity ?? equity;
    return {
      timestamp: dayIndex * 86_400_000,
      date: new Date(dayIndex * 86_400_000).toISOString().slice(0, 10),
      equity,
      cashBalance: equity,
      dailyReturn: prev > 0 ? (equity - prev) / prev : 0,
      cumulativeReturn: 0,
    };
  };

  /** Build an equity curve from a list of daily equity values. */
  const makeCurve = (equities: number[]): AnalyticsEquityPoint[] =>
    equities.map((e, i) => makePoint(i, e, i > 0 ? equities[i - 1] : e));

  // ── Empty input ────────────────────────────────────────────────────────────

  describe('with empty equity curve', () => {
    it('returns 0 for all ratio metrics', () => {
      const result = calculator.compute([], []);
      expect(result.sharpeRatio).toBe(0);
      expect(result.sortinoRatio).toBe(0);
      expect(result.calmarRatio).toBe(0);
      expect(result.maxDrawdown).toBe(0);
      expect(result.ulcerIndex).toBe(0);
      expect(result.painIndex).toBe(0);
    });
  });

  // ── Sharpe ratio ───────────────────────────────────────────────────────────

  describe('sharpeRatio', () => {
    it('returns 0 when returns have zero std (flat equity)', () => {
      const curve = makeCurve([10_000, 10_000, 10_000, 10_000, 10_000]);
      const result = calculator.compute(curve, []);
      expect(result.sharpeRatio).toBe(0);
    });

    it('is positive when mean excess return is positive', () => {
      // Rising equity → positive daily returns → positive Sharpe
      const curve = makeCurve([10_000, 10_200, 10_400, 10_600, 10_800]);
      const result = calculator.compute(curve, []);
      expect(result.sharpeRatio).toBeGreaterThan(0);
    });

    it('is negative when mean excess return is negative', () => {
      // Falling equity → negative daily returns → negative Sharpe
      const curve = makeCurve([10_000, 9_800, 9_600, 9_400, 9_200]);
      const result = calculator.compute(curve, []);
      expect(result.sharpeRatio).toBeLessThan(0);
    });
  });

  // ── Sortino ratio ──────────────────────────────────────────────────────────

  describe('sortinoRatio', () => {
    it('returns Infinity when ALL daily returns exceed the risk-free rate', () => {
      // Build equity points where every dailyReturn is well above RISK_FREE_DAILY (≈0.0002).
      // Using 0.5% daily return — far above the threshold — so negReturns.length === 0.
      const DAY = 86_400_000;
      const DAILY_RETURN = 0.005; // 0.5% >> RISK_FREE_DAILY
      const points = Array.from({ length: 10 }, (_, i): AnalyticsEquityPoint => ({
        timestamp: i * DAY,
        date: new Date(i * DAY).toISOString().slice(0, 10),
        equity: 10_000 * Math.pow(1 + DAILY_RETURN, i),
        cashBalance: 10_000 * Math.pow(1 + DAILY_RETURN, i),
        dailyReturn: DAILY_RETURN, // all above risk-free → no downside
        cumulativeReturn: Math.pow(1 + DAILY_RETURN, i) - 1,
      }));
      const result = calculator.compute(points, []);
      expect(result.sortinoRatio).toBe(Infinity);
    });

    it('returns a negative value when all returns equal zero (below risk-free rate)', () => {
      // A flat equity curve has dailyReturn = 0, which is below RISK_FREE_DAILY.
      // The excess mean is therefore negative, resulting in a negative Sortino ratio.
      const curve = makeCurve([10_000, 10_000, 10_000]);
      const result = calculator.compute(curve, []);
      expect(result.sortinoRatio).toBeLessThan(0);
    });
  });

  // ── Drawdown metrics ───────────────────────────────────────────────────────

  describe('drawdown', () => {
    it('computes max drawdown = 0 for monotonically increasing equity', () => {
      const curve = makeCurve([10_000, 10_100, 10_200, 10_300]);
      const result = calculator.compute(curve, []);
      expect(result.maxDrawdown).toBe(0);
    });

    it('computes max drawdown correctly for known peak-trough', () => {
      // Peak = 12000, trough = 9000 → dd = (12000-9000)/12000 = 0.25
      const curve = makeCurve([10_000, 12_000, 9_000, 10_000]);
      const result = calculator.compute(curve, []);
      expect(result.maxDrawdown).toBeCloseTo(0.25, 3);
    });

    it('computes maxDrawdownAbsolute > 0 when drawdown occurs', () => {
      const curve = makeCurve([10_000, 12_000, 9_000, 10_000]);
      const result = calculator.compute(curve, []);
      expect(result.maxDrawdownAbsolute).toBeGreaterThan(0);
    });

    it('computes averageDrawdown as mean of all drawdown values', () => {
      // Constant drawdown: peak 12000, values all at 9000 for 2 days then recover
      const curve = makeCurve([10_000, 12_000, 9_000, 9_000, 12_000]);
      const result = calculator.compute(curve, []);
      // average drawdown should be positive since drawdowns occur
      expect(result.averageDrawdown).toBeGreaterThan(0);
    });
  });

  // ── Calmar ratio ───────────────────────────────────────────────────────────

  describe('calmarRatio', () => {
    it('returns 0 when max drawdown is 0', () => {
      const curve = makeCurve([10_000, 11_000, 12_000]);
      const result = calculator.compute(curve, []);
      // Monotonically increasing → no drawdown → calmar = 0
      expect(result.calmarRatio).toBe(0);
    });

    it('is positive when strategy has positive return with drawdown', () => {
      // Peak→trough (drawdown) but ends higher than start
      const curve = makeCurve([10_000, 12_000, 9_000, 14_000]);
      const result = calculator.compute(curve, []);
      expect(result.calmarRatio).toBeGreaterThan(0);
    });
  });

  // ── Omega ratio ────────────────────────────────────────────────────────────

  describe('omegaRatio', () => {
    it('returns Infinity when all returns are positive', () => {
      const curve = makeCurve([10_000, 10_100, 10_200, 10_300]);
      const result = calculator.compute(curve, []);
      expect(result.omegaRatio).toBe(Infinity);
    });

    it('is greater than 1 when gains outweigh losses', () => {
      // 3 gains of 2% each, 1 loss of 1% → omega > 1
      const curve = makeCurve([10_000, 10_200, 10_404, 10_612, 10_506]);
      const result = calculator.compute(curve, []);
      expect(result.omegaRatio).toBeGreaterThan(1);
    });
  });

  // ── Ulcer Index ────────────────────────────────────────────────────────────

  describe('ulcerIndex', () => {
    it('returns 0 when there is no drawdown', () => {
      const curve = makeCurve([10_000, 10_100, 10_200]);
      const result = calculator.compute(curve, []);
      expect(result.ulcerIndex).toBe(0);
    });

    it('returns positive value when drawdown occurs', () => {
      const curve = makeCurve([10_000, 12_000, 9_000, 10_000]);
      const result = calculator.compute(curve, []);
      expect(result.ulcerIndex).toBeGreaterThan(0);
    });
  });

  // ── Rolling Sharpe ────────────────────────────────────────────────────────

  describe('rolling Sharpe', () => {
    it('returns 0 when fewer points than window', () => {
      const curve = makeCurve([10_000, 10_100]); // only 2 points, window=7
      const result = calculator.compute(curve, []);
      expect(result.rollingSharpe7d).toBe(0);
    });

    it('returns non-zero with sufficient data', () => {
      const curve = Array.from({ length: 30 }, (_, i) =>
        makePoint(i, 10_000 + i * 100, i > 0 ? 10_000 + (i - 1) * 100 : undefined),
      );
      const result = calculator.compute(curve, []);
      expect(result.rollingSharpe7d).not.toBe(0);
      expect(result.rollingSharpe30d).not.toBe(0);
    });
  });

  // ── Pain Index ─────────────────────────────────────────────────────────────

  it('pain index is mean of drawdown percentages and therefore ≥ 0', () => {
    const curve = makeCurve([10_000, 12_000, 9_000, 9_000, 12_000]);
    const result = calculator.compute(curve, []);
    expect(result.painIndex).toBeGreaterThanOrEqual(0);
  });

  // ── Large dataset ──────────────────────────────────────────────────────────

  it('handles a 365-day equity curve without errors', () => {
    const equities = Array.from(
      { length: 366 },
      (_, i) => 10_000 * (1 + i * 0.001 + Math.sin(i) * 0.005),
    );
    const curve = makeCurve(equities);
    const result = calculator.compute(curve, []);
    expect(isFinite(result.sharpeRatio)).toBe(true);
    expect(isFinite(result.sortinoRatio) || result.sortinoRatio === Infinity).toBe(true);
    expect(result.maxDrawdown).toBeGreaterThanOrEqual(0);
    expect(result.maxDrawdown).toBeLessThanOrEqual(1);
  });
});
