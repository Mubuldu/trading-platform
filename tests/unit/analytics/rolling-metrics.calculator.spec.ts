import { RollingMetricsCalculator } from '@modules/analytics/application/calculators/rolling-metrics.calculator';
import {
  AnalyticsEquityPoint,
  AnalyticsTrade,
} from '@modules/analytics/domain/models/analytics-trade.model';
import { RollingWindow } from '@modules/analytics/domain/enums/rolling-window.enum';

describe('RollingMetricsCalculator', () => {
  let calculator: RollingMetricsCalculator;

  const MS_PER_DAY = 86_400_000;

  beforeEach(() => {
    calculator = new RollingMetricsCalculator();
  });

  // ── Equity point and trade factories ─────────────────────────────────────────

  /**
   * Build an equity point for a given day offset from a reference timestamp.
   * nowMs is treated as the latest point (day 0), older points use negative offsets.
   */
  const makePoint = (
    daysAgo: number,
    equity: number,
    prevEquity: number,
    nowMs: number,
  ): AnalyticsEquityPoint => {
    const timestamp = nowMs - daysAgo * MS_PER_DAY;
    return {
      timestamp,
      date: new Date(timestamp).toISOString().slice(0, 10),
      equity,
      cashBalance: equity,
      dailyReturn: prevEquity > 0 ? (equity - prevEquity) / prevEquity : 0,
      cumulativeReturn: 0,
    };
  };

  /**
   * Build a simple ascending equity curve of `count` points ending at `nowMs`.
   * Each day adds `dailyGain` to equity.
   */
  const buildCurve = (
    count: number,
    startEquity: number,
    dailyGain: number,
    nowMs: number,
  ): AnalyticsEquityPoint[] => {
    const points: AnalyticsEquityPoint[] = [];
    for (let i = count - 1; i >= 0; i--) {
      const equity = startEquity + (count - 1 - i) * dailyGain;
      const prevEquity = startEquity + Math.max(0, count - 2 - i) * dailyGain;
      points.push(makePoint(i, equity, prevEquity, nowMs));
    }
    return points.sort((a, b) => a.timestamp - b.timestamp);
  };

  const makeTrade = (exitDaysAgo: number, netPnl: number, nowMs: number): AnalyticsTrade => ({
    tradeId: `t_${exitDaysAgo}_${netPnl}`,
    strategyId: 'test',
    symbol: 'BTC/USDT',
    exchangeId: 'paper',
    side: netPnl >= 0 ? 'LONG' : 'SHORT',
    entryTime: nowMs - (exitDaysAgo + 1) * MS_PER_DAY,
    exitTime: nowMs - exitDaysAgo * MS_PER_DAY,
    entryPrice: 40_000,
    exitPrice: 40_000 + netPnl,
    quantity: 1,
    grossPnl: netPnl + 10,
    commission: 10,
    netPnl,
    slippage: 5,
    durationMs: MS_PER_DAY,
  });

  // ── Empty input ──────────────────────────────────────────────────────────────

  describe('with empty input', () => {
    it('returns RollingMetrics with all 5 windows', () => {
      const result = calculator.compute([], []);
      expect(result.sevenDay).toBeDefined();
      expect(result.thirtyDay).toBeDefined();
      expect(result.ninetyDay).toBeDefined();
      expect(result.oneEightyDay).toBeDefined();
      expect(result.threeSixtyFiveDay).toBeDefined();
      expect(result.computedAt).toBeGreaterThan(0);
    });

    it('returns 0 for ratio metrics when no data', () => {
      const result = calculator.compute([], []);
      expect(result.sevenDay.sharpeRatio).toBe(0);
      expect(result.sevenDay.sortinoRatio).toBe(0);
      expect(result.sevenDay.totalReturnPercent).toBe(0);
      expect(result.sevenDay.totalTrades).toBe(0);
    });
  });

  // ── Window filtering ─────────────────────────────────────────────────────────

  describe('window slicing', () => {
    it('sevenDay window only includes the last 7 days of data', () => {
      const nowMs = Date.now();
      // 40 days of data; 30 trades; only last 7 should count for sevenDay
      const curve = buildCurve(40, 10_000, 50, nowMs);
      const trades = [
        makeTrade(5, 200, nowMs), // within 7 days
        makeTrade(5, 300, nowMs), // within 7 days
        makeTrade(20, 500, nowMs), // outside 7 days
        makeTrade(35, 100, nowMs), // outside 7 days
      ];
      const result = calculator.compute(curve, trades);
      expect(result.sevenDay.totalTrades).toBe(2);
    });

    it('thirtyDay window includes trades within last 30 days', () => {
      const nowMs = Date.now();
      const curve = buildCurve(40, 10_000, 50, nowMs);
      const trades = [
        makeTrade(5, 200, nowMs), // within 30 days
        makeTrade(25, 300, nowMs), // within 30 days
        makeTrade(35, 400, nowMs), // outside 30 days
      ];
      const result = calculator.compute(curve, trades);
      expect(result.thirtyDay.totalTrades).toBe(2);
    });

    it('threeSixtyFiveDay window captures all 365 days of data', () => {
      const nowMs = Date.now();
      const curve = buildCurve(365, 10_000, 10, nowMs);
      const trades = [
        makeTrade(300, 100, nowMs),
        makeTrade(200, 200, nowMs),
        makeTrade(10, 150, nowMs),
      ];
      const result = calculator.compute(curve, trades);
      expect(result.threeSixtyFiveDay.totalTrades).toBe(3);
    });
  });

  // ── Return computation ───────────────────────────────────────────────────────

  describe('return computation', () => {
    it('totalReturnPercent is positive for rising equity in window', () => {
      const nowMs = Date.now();
      const curve = buildCurve(10, 10_000, 100, nowMs); // 10000 → 10900
      const result = calculator.compute(curve, []);
      expect(result.sevenDay.totalReturnPercent).toBeGreaterThan(0);
    });

    it('totalReturnPercent is 0 when fewer than 2 points in window', () => {
      const nowMs = Date.now();
      // Only 1 equity point within the 7-day window
      const points: AnalyticsEquityPoint[] = [makePoint(1, 10_000, 10_000, nowMs)];
      const result = calculator.compute(points, []);
      expect(result.sevenDay.totalReturnPercent).toBe(0);
    });
  });

  // ── Sharpe ratio ─────────────────────────────────────────────────────────────

  describe('sharpe ratio', () => {
    it('sevenDay sharpe is positive for consistent uptrend', () => {
      const nowMs = Date.now();
      const curve = buildCurve(10, 10_000, 200, nowMs);
      const result = calculator.compute(curve, []);
      expect(result.sevenDay.sharpeRatio).toBeGreaterThan(0);
    });

    it('sevenDay sharpe is 0 when fewer than 2 data points', () => {
      const nowMs = Date.now();
      const points: AnalyticsEquityPoint[] = [makePoint(3, 10_000, 10_000, nowMs)];
      const result = calculator.compute(points, []);
      expect(result.sevenDay.sharpeRatio).toBe(0);
    });
  });

  // ── Profit factor ─────────────────────────────────────────────────────────────

  describe('profit factor', () => {
    it('is Infinity when all window trades are winners', () => {
      const nowMs = Date.now();
      const curve = buildCurve(10, 10_000, 100, nowMs);
      const trades = [makeTrade(3, 200, nowMs), makeTrade(5, 300, nowMs)];
      const result = calculator.compute(curve, trades);
      expect(result.sevenDay.profitFactor).toBe(Infinity);
    });

    it('is 2.0 for 600 gross profit / 300 gross loss', () => {
      const nowMs = Date.now();
      const curve = buildCurve(10, 10_000, 100, nowMs);
      const trades = [
        makeTrade(2, 200, nowMs),
        makeTrade(3, 300, nowMs),
        makeTrade(4, 100, nowMs),
        makeTrade(5, -150, nowMs),
        makeTrade(6, -150, nowMs),
      ];
      const result = calculator.compute(curve, trades);
      // grossProfit = 600, grossLoss = 300, profitFactor = 2.0
      expect(result.sevenDay.profitFactor).toBeCloseTo(2.0);
    });
  });

  // ── Drawdown in window ────────────────────────────────────────────────────────

  describe('maxDrawdown', () => {
    it('is 0 for monotonically increasing equity', () => {
      const nowMs = Date.now();
      const curve = buildCurve(10, 10_000, 100, nowMs);
      const result = calculator.compute(curve, []);
      expect(result.sevenDay.maxDrawdown).toBeCloseTo(0);
    });
  });

  // ── computeForWindows ────────────────────────────────────────────────────────

  describe('computeForWindows', () => {
    it('returns metrics for the specified windows only', () => {
      const nowMs = Date.now();
      const curve = buildCurve(10, 10_000, 100, nowMs);
      const result = calculator.computeForWindows(
        curve,
        [],
        [RollingWindow.SEVEN_DAYS, RollingWindow.THIRTY_DAYS],
      );
      expect(result).toHaveLength(2);
      expect(result[0]!.window).toBe(RollingWindow.SEVEN_DAYS);
      expect(result[1]!.window).toBe(RollingWindow.THIRTY_DAYS);
    });
  });

  // ── Volatility ────────────────────────────────────────────────────────────────

  it('annualizedVolatility is dailyVolatility * sqrt(252)', () => {
    const nowMs = Date.now();
    const curve = buildCurve(40, 10_000, 50, nowMs);
    const result = calculator.compute(curve, []);
    const sevenDay = result.sevenDay;
    expect(sevenDay.annualizedVolatility).toBeCloseTo(sevenDay.dailyVolatility * Math.sqrt(252), 5);
  });
});
