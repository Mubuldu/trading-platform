import { ExecutionAnalyticsCalculator } from '@modules/analytics/application/calculators/execution-analytics.calculator';
import { AnalyticsFill } from '@modules/analytics/domain/models/analytics-trade.model';

describe('ExecutionAnalyticsCalculator', () => {
  let calculator: ExecutionAnalyticsCalculator;

  beforeEach(() => {
    calculator = new ExecutionAnalyticsCalculator();
  });

  const makeFill = (slippage: number, commission = 10, latencyMs?: number): AnalyticsFill => ({
    fillId: `fill_${Math.random()}`,
    orderId: `order_${Math.random()}`,
    strategyId: 'test',
    symbol: 'BTC/USDT',
    exchangeId: 'paper',
    side: 'BUY',
    filledQuantity: 0.1,
    fillPrice: 40_000,
    notional: 4_000,
    commission,
    slippage,
    realizedPnl: 0,
    filledAt: Date.now(),
    latencyMs,
  });

  // ── Empty input ────────────────────────────────────────────────────────────

  describe('with no fills', () => {
    it('returns zeros and default rates', () => {
      const result = calculator.compute([]);
      expect(result.averageSlippage).toBe(0);
      expect(result.medianSlippage).toBe(0);
      expect(result.worstSlippage).toBe(0);
      expect(result.totalSlippage).toBe(0);
      expect(result.averageLatencyMs).toBe(0);
      expect(result.totalFills).toBe(0);
      expect(result.totalCommission).toBe(0);
      // Default rates for paper (no fills submitted)
      expect(result.orderFillRate).toBe(1);
      expect(result.cancelRate).toBe(0);
      expect(result.rejectedOrderRate).toBe(0);
    });
  });

  // ── Slippage statistics ───────────────────────────────────────────────────

  describe('slippage', () => {
    it('computes averageSlippage correctly', () => {
      const fills = [makeFill(10), makeFill(20), makeFill(30)];
      const result = calculator.compute(fills);
      expect(result.averageSlippage).toBeCloseTo(20);
    });

    it('computes medianSlippage for odd count', () => {
      const fills = [makeFill(5), makeFill(15), makeFill(100)];
      const result = calculator.compute(fills);
      expect(result.medianSlippage).toBeCloseTo(15);
    });

    it('computes medianSlippage for even count', () => {
      const fills = [makeFill(10), makeFill(20), makeFill(30), makeFill(40)];
      const result = calculator.compute(fills);
      // median of [10,20,30,40] = (20+30)/2 = 25
      expect(result.medianSlippage).toBeCloseTo(25);
    });

    it('computes worstSlippage as the maximum', () => {
      const fills = [makeFill(5), makeFill(100), makeFill(50)];
      const result = calculator.compute(fills);
      expect(result.worstSlippage).toBeCloseTo(100);
    });

    it('computes totalSlippage as the sum', () => {
      const fills = [makeFill(10), makeFill(20), makeFill(30)];
      const result = calculator.compute(fills);
      expect(result.totalSlippage).toBeCloseTo(60);
    });
  });

  // ── Latency statistics ────────────────────────────────────────────────────

  describe('latency', () => {
    it('returns 0 for latency metrics when no fills have latencyMs', () => {
      const fills = [makeFill(10), makeFill(20)]; // no latencyMs
      const result = calculator.compute(fills);
      expect(result.averageLatencyMs).toBe(0);
      expect(result.medianLatencyMs).toBe(0);
      expect(result.maxLatencyMs).toBe(0);
      expect(result.p95LatencyMs).toBe(0);
    });

    it('computes latency metrics correctly when present', () => {
      const fills = [
        makeFill(10, 10, 100),
        makeFill(10, 10, 200),
        makeFill(10, 10, 150),
        makeFill(10, 10, 1000), // outlier for p95
      ];
      const result = calculator.compute(fills);
      expect(result.averageLatencyMs).toBeCloseTo((100 + 200 + 150 + 1000) / 4);
      expect(result.maxLatencyMs).toBeCloseTo(1000);
      expect(result.p95LatencyMs).toBeGreaterThan(result.medianLatencyMs);
    });
  });

  // ── Total commission ──────────────────────────────────────────────────────

  it('sums total commission across all fills', () => {
    const fills = [makeFill(10, 5), makeFill(20, 10), makeFill(30, 15)];
    const result = calculator.compute(fills);
    expect(result.totalCommission).toBeCloseTo(30);
  });

  // ── Fill quality rates ─────────────────────────────────────────────────────

  describe('fill quality rates', () => {
    it('computes orderFillRate as fills/submitted', () => {
      const fills = [makeFill(10), makeFill(20)];
      const result = calculator.compute(fills, { totalSubmitted: 5 });
      // 2 fills / 5 submitted = 0.4
      expect(result.orderFillRate).toBeCloseTo(0.4);
    });

    it('computes cancelRate as cancelled/submitted', () => {
      const fills = [makeFill(10)];
      const result = calculator.compute(fills, { totalSubmitted: 4, totalCancelled: 2 });
      expect(result.cancelRate).toBeCloseTo(0.5);
    });

    it('defaults to fill rate = 1 when totalSubmitted is not provided', () => {
      const fills = [makeFill(10)];
      const result = calculator.compute(fills);
      expect(result.orderFillRate).toBeCloseTo(1);
    });
  });

  // ── Large dataset ─────────────────────────────────────────────────────────

  it('handles 5000 fills without errors', () => {
    const fills = Array.from({ length: 5000 }, (_, i) => makeFill(i % 100));
    const result = calculator.compute(fills);
    expect(result.totalFills).toBe(5000);
    expect(result.averageSlippage).toBeGreaterThanOrEqual(0);
    expect(isFinite(result.averageSlippage)).toBe(true);
  });
});
