import { PortfolioMetricsService } from '../../../src/modules/portfolio/application/services/portfolio-metrics.service';
import { DailyPnlRecord } from '../../../src/modules/portfolio/domain/models/performance.model';

function makeRecord(date: string, netPnl: number, equity: number): DailyPnlRecord {
  return {
    date,
    realizedPnl: netPnl,
    unrealizedPnl: 0,
    fees: 0,
    netPnl,
    equity,
    returnPercent: equity > 0 ? netPnl / (equity - netPnl) : 0,
  };
}

describe('PortfolioMetricsService', () => {
  let svc: PortfolioMetricsService;

  beforeEach(() => {
    svc = new PortfolioMetricsService();
  });

  // ── Sharpe ────────────────────────────────────────────────────────────────

  describe('computeSharpe', () => {
    it('returns 0 for empty returns', () => {
      expect(svc.computeSharpe([])).toBe(0);
    });

    it('returns 0 for a single return', () => {
      expect(svc.computeSharpe([0.01])).toBe(0);
    });

    it('returns positive ratio for consistently positive returns', () => {
      const returns = Array(252).fill(0.001);
      expect(svc.computeSharpe(returns, 0)).toBeGreaterThan(0);
    });

    it('returns negative ratio for consistently negative returns', () => {
      const returns = Array(252).fill(-0.001);
      expect(svc.computeSharpe(returns, 0)).toBeLessThan(0);
    });

    it('returns 0 when all returns equal the risk-free rate', () => {
      const rfDaily = 0.05 / 252;
      const returns = Array(252).fill(rfDaily);
      expect(svc.computeSharpe(returns, 0.05)).toBe(0);
    });
  });

  // ── Sortino ───────────────────────────────────────────────────────────────

  describe('computeSortino', () => {
    it('returns 0 for empty returns', () => {
      expect(svc.computeSortino([])).toBe(0);
    });

    it('returns Infinity when there are only positive excess returns', () => {
      const returns = Array(50).fill(0.01);
      expect(svc.computeSortino(returns, 0)).toBe(Infinity);
    });

    it('is higher than Sharpe when returns are right-skewed (few large wins)', () => {
      const returns = [0.05, 0.03, 0.02, 0.04, -0.001, 0.01];
      const sharpe = svc.computeSharpe(returns, 0);
      const sortino = svc.computeSortino(returns, 0);
      expect(sortino).toBeGreaterThan(sharpe);
    });
  });

  // ── Max Drawdown ─────────────────────────────────────────────────────────

  describe('computeMaxDrawdown', () => {
    it('returns 0 for flat equity', () => {
      const { relative } = svc.computeMaxDrawdown([100, 100, 100]);
      expect(relative).toBe(0);
    });

    it('computes 50% drawdown correctly', () => {
      const { relative } = svc.computeMaxDrawdown([100, 50]);
      expect(relative).toBeCloseTo(0.5);
    });

    it('computes 20% drawdown correctly', () => {
      const { relative } = svc.computeMaxDrawdown([100, 110, 88]);
      expect(relative).toBeCloseTo(0.2, 5);
    });

    it('handles recovery correctly — drawdown is historical peak-to-trough', () => {
      const { relative } = svc.computeMaxDrawdown([100, 50, 120]);
      expect(relative).toBeCloseTo(0.5);
    });

    it('returns absolute drawdown value', () => {
      const { absolute } = svc.computeMaxDrawdown([200, 100]);
      expect(absolute).toBe(100);
    });
  });

  // ── Rolling Drawdown ──────────────────────────────────────────────────────

  describe('computeRollingDrawdown', () => {
    it('returns 0 for empty curve', () => {
      expect(svc.computeRollingDrawdown([])).toBe(0);
    });

    it('returns 0 when at peak', () => {
      const curve = [100, 110, 120];
      expect(svc.computeRollingDrawdown(curve, 30)).toBe(0);
    });

    it('computes rolling drawdown within window', () => {
      const curve = [100, 90, 80, 70];
      const dd = svc.computeRollingDrawdown(curve, 4);
      expect(dd).toBeCloseTo(0.3, 5);
    });
  });

  // ── Volatility ────────────────────────────────────────────────────────────

  describe('computeVolatility', () => {
    it('returns 0 for fewer than 2 returns', () => {
      expect(svc.computeVolatility([0.01])).toBe(0);
    });

    it('returns ~0 for constant returns (floating-point tolerance)', () => {
      const returns = Array(50).fill(0.01);
      expect(svc.computeVolatility(returns)).toBeCloseTo(0, 10);
    });

    it('returns positive annualized volatility for varied returns', () => {
      const returns = [0.01, -0.02, 0.03, -0.01, 0.02];
      expect(svc.computeVolatility(returns)).toBeGreaterThan(0);
    });
  });

  // ── Profit Factor ─────────────────────────────────────────────────────────

  describe('computeProfitFactor', () => {
    it('returns Infinity when no losses', () => {
      expect(svc.computeProfitFactor(1000, 0)).toBe(Infinity);
    });

    it('computes 2.0 correctly', () => {
      expect(svc.computeProfitFactor(2000, 1000)).toBe(2);
    });

    it('returns 0 when no profit and no loss', () => {
      expect(svc.computeProfitFactor(0, 0)).toBe(0);
    });
  });

  // ── Recovery Factor ───────────────────────────────────────────────────────

  describe('computeRecoveryFactor', () => {
    it('returns Infinity with zero max drawdown but positive profit', () => {
      expect(svc.computeRecoveryFactor(5000, 0)).toBe(Infinity);
    });

    it('computes correctly', () => {
      expect(svc.computeRecoveryFactor(10000, 2000)).toBe(5);
    });
  });

  // ── Expectancy ────────────────────────────────────────────────────────────

  describe('computeExpectancy', () => {
    it('returns positive expectancy for win rate > 50% with equal avg win/loss', () => {
      expect(svc.computeExpectancy(0.6, 100, 100)).toBeCloseTo(20, 5);
    });

    it('returns 0 for break-even setup', () => {
      expect(svc.computeExpectancy(0.5, 100, 100)).toBeCloseTo(0, 5);
    });

    it('can be positive even with <50% win rate if avg win >> avg loss', () => {
      expect(svc.computeExpectancy(0.3, 300, 100)).toBeGreaterThan(0);
    });
  });

  // ── computeAll ────────────────────────────────────────────────────────────

  describe('computeAll', () => {
    it('returns zeroed metrics for empty records', () => {
      const result = svc.computeAll([], 100_000);
      expect(result.sharpeRatio).toBe(0);
      expect(result.maxDrawdown).toBe(0);
      expect(result.profitFactor).toBe(0);
      expect(result.computedAt).toBeGreaterThan(0);
    });

    it('computes metrics from daily records', () => {
      const records: DailyPnlRecord[] = [
        makeRecord('2024-01-01', 500, 100_500),
        makeRecord('2024-01-02', -200, 100_300),
        makeRecord('2024-01-03', 800, 101_100),
        makeRecord('2024-01-04', -100, 101_000),
        makeRecord('2024-01-05', 600, 101_600),
      ];
      const result = svc.computeAll(records, 101_600, 0.05, 252);
      expect(result.profitFactor).toBeGreaterThan(1);
      expect(result.maxDrawdown).toBeGreaterThanOrEqual(0);
      expect(result.computedAt).toBeGreaterThan(0);
    });
  });

  // ── Period stats ──────────────────────────────────────────────────────────

  describe('computePeriodStats', () => {
    it('returns zeros for empty records', () => {
      const result = svc.computePeriodStats([]);
      expect(result.returnAbsolute).toBe(0);
      expect(result.winDays).toBe(0);
    });

    it('counts win/loss days correctly', () => {
      const records = [
        makeRecord('2024-01-01', 100, 100_100),
        makeRecord('2024-01-02', -50, 100_050),
        makeRecord('2024-01-03', 200, 100_250),
      ];
      const result = svc.computePeriodStats(records);
      expect(result.winDays).toBe(2);
      expect(result.lossDays).toBe(1);
      expect(result.returnAbsolute).toBe(250);
    });
  });

  // ── sliceByDays ───────────────────────────────────────────────────────────

  describe('sliceByDays', () => {
    it('returns empty for empty records', () => {
      expect(svc.sliceByDays([], 7)).toHaveLength(0);
    });

    it('filters records older than window', () => {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      const lastWeek = new Date(today);
      lastWeek.setDate(today.getDate() - 10);

      const records = [
        makeRecord(lastWeek.toISOString().slice(0, 10), 100, 100_100),
        makeRecord(yesterday.toISOString().slice(0, 10), 200, 100_300),
      ];
      const result = svc.sliceByDays(records, 7);
      expect(result).toHaveLength(1);
    });
  });
});
