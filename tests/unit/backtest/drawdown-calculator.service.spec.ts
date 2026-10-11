import { DrawdownCalculatorService } from '@modules/backtest/application/reports/statistics/drawdown-calculator.service';
import { EquityCurvePoint } from '@modules/backtest/domain/models/equity-curve-point.model';

describe('DrawdownCalculatorService', () => {
  let service: DrawdownCalculatorService;

  beforeEach(() => {
    service = new DrawdownCalculatorService();
  });

  const makePoint = (timestamp: number, equity: number): EquityCurvePoint => ({
    timestamp,
    equity,
    cash: equity,
    unrealizedPnl: 0,
    peakEquity: equity,
    drawdown: 0,
    drawdownPercent: 0,
  });

  it('returns zeros for empty curve', () => {
    const result = service.compute([]);
    expect(result.maxDrawdownPercent).toBe(0);
    expect(result.maxDrawdownDurationMs).toBe(0);
    expect(result.allDrawdownPeriods).toHaveLength(0);
  });

  it('returns zeros when equity only increases', () => {
    const curve = [1000, 1100, 1200, 1300].map((e, i) => makePoint(i * 86_400_000, e));
    const result = service.compute(curve);
    expect(result.maxDrawdownPercent).toBe(0);
    expect(result.allDrawdownPeriods).toHaveLength(0);
  });

  it('computes max drawdown from peak to trough', () => {
    const curve = [
      makePoint(0, 1000),
      makePoint(1, 1100),
      makePoint(2, 900),
      makePoint(3, 950),
      makePoint(4, 1050),
    ];
    const result = service.compute(curve);
    // peak=1100, trough=900: (1100-900)/1100 * 100 ≈ 18.18%
    expect(result.maxDrawdownPercent).toBeCloseTo(18.18, 1);
  });

  it('finds the correct max drawdown period with recovery', () => {
    const curve = [
      makePoint(0, 1000),
      makePoint(86_400_000, 1200),
      makePoint(86_400_000 * 2, 800),
      makePoint(86_400_000 * 3, 700),
      makePoint(86_400_000 * 4, 1300),
    ];
    const result = service.compute(curve);
    // peak=1200, trough=700: (1200-700)/1200 * 100 ≈ 41.67%
    expect(result.maxDrawdownPercent).toBeCloseTo(41.67, 1);
    expect(result.maxDrawdownPeriod).toBeDefined();
    expect(result.maxDrawdownPeriod!.recoveryTime).toBeDefined();
  });

  it('handles unrecovered drawdown at end of curve', () => {
    const curve = [makePoint(0, 1000), makePoint(86_400_000, 800), makePoint(86_400_000 * 2, 600)];
    const result = service.compute(curve);
    // peak=1000, trough=600: (1000-600)/1000 * 100 = 40%
    expect(result.maxDrawdownPercent).toBeCloseTo(40, 1);
    expect(result.maxDrawdownPeriod!.recoveryTime).toBeUndefined();
  });

  it('identifies multiple separate drawdown periods', () => {
    const curve = [
      makePoint(0, 1000),
      makePoint(1, 800),
      makePoint(2, 1100),
      makePoint(3, 900),
      makePoint(4, 1200),
    ];
    const result = service.compute(curve);
    expect(result.allDrawdownPeriods).toHaveLength(2);
  });
});
