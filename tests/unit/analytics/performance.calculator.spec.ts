import { PerformanceCalculator } from '@modules/analytics/application/calculators/performance.calculator';
import { AnalyticsTrade } from '@modules/analytics/domain/models/analytics-trade.model';

describe('PerformanceCalculator', () => {
  let calculator: PerformanceCalculator;

  beforeEach(() => {
    calculator = new PerformanceCalculator();
  });

  // ── Known dataset factory ───────────────────────────────────────────────────

  const makeTrade = (netPnl: number, durationMs = 3_600_000): AnalyticsTrade => ({
    tradeId: `t_${Math.random()}`,
    strategyId: 'test_strategy',
    symbol: 'BTC/USDT',
    exchangeId: 'paper_trading',
    side: netPnl >= 0 ? 'LONG' : 'SHORT',
    entryTime: 1_700_000_000_000,
    exitTime: 1_700_000_000_000 + durationMs,
    entryPrice: 40_000,
    exitPrice: 40_000 + netPnl,
    quantity: 1,
    grossPnl: netPnl + 10,
    commission: 10,
    netPnl,
    slippage: 5,
    durationMs,
  });

  const START = 1_700_000_000_000;
  const END = START + 365 * 86_400_000; // 1 year

  // ── Zero trades ────────────────────────────────────────────────────────────

  describe('with no trades', () => {
    it('returns zero for all counts and ratios', () => {
      const result = calculator.compute([], 10_000, 10_000, START, END);
      expect(result.totalTrades).toBe(0);
      expect(result.winningTrades).toBe(0);
      expect(result.losingTrades).toBe(0);
      expect(result.netProfit).toBe(0);
      expect(result.grossProfit).toBe(0);
      expect(result.grossLoss).toBe(0);
      expect(result.winningPercent).toBe(0);
      expect(result.losingPercent).toBe(0);
      expect(result.profitFactor).toBe(0);
      expect(result.expectancy).toBe(0);
      expect(result.payoffRatio).toBe(0);
    });

    it('computes annualized return correctly when equity changes without trades', () => {
      const result = calculator.compute([], 10_000, 12_000, START, END);
      expect(result.netProfit).toBeCloseTo(2_000);
      expect(result.totalReturnPercent).toBeCloseTo(20);
      // Annualized over ~1 year should be close to 20%
      expect(result.annualizedReturnPercent).toBeCloseTo(20, 0);
    });
  });

  // ── Single winning trade ───────────────────────────────────────────────────

  describe('with a single winning trade', () => {
    it('computes win rate = 1, loss rate = 0', () => {
      const result = calculator.compute([makeTrade(500)], 10_000, 10_500, START, END);
      expect(result.winningPercent).toBeCloseTo(1);
      expect(result.losingPercent).toBeCloseTo(0);
      expect(result.totalTrades).toBe(1);
      expect(result.winningTrades).toBe(1);
      expect(result.losingTrades).toBe(0);
    });

    it('profit factor is Infinity when no losses', () => {
      const result = calculator.compute([makeTrade(500)], 10_000, 10_500, START, END);
      expect(result.profitFactor).toBe(Infinity);
    });
  });

  // ── Mixed win/loss dataset ─────────────────────────────────────────────────

  describe('with mixed win/loss trades (known dataset)', () => {
    // 3 wins: +200, +300, +100 → grossProfit = 600, avgWin = 200
    // 2 losses: -100, -200   → grossLoss = 300, avgLoss = 150
    const trades = [
      makeTrade(200),
      makeTrade(300),
      makeTrade(100),
      makeTrade(-100),
      makeTrade(-200),
    ];
    const initial = 10_000;
    const final = 10_300; // net = 300 (grossProfit - grossLoss = 600-300)

    let result: ReturnType<PerformanceCalculator['compute']>;

    beforeEach(() => {
      result = calculator.compute(trades, initial, final, START, END);
    });

    it('counts winning and losing trades correctly', () => {
      expect(result.totalTrades).toBe(5);
      expect(result.winningTrades).toBe(3);
      expect(result.losingTrades).toBe(2);
      expect(result.breakEvenTrades).toBe(0);
    });

    it('computes gross profit and gross loss', () => {
      expect(result.grossProfit).toBeCloseTo(600);
      expect(result.grossLoss).toBeCloseTo(300);
    });

    it('computes net profit correctly', () => {
      // netProfit = finalEquity - initialCapital = 10300 - 10000 = 300
      expect(result.netProfit).toBeCloseTo(300);
    });

    it('computes profit factor = grossProfit / grossLoss', () => {
      // 600 / 300 = 2.0
      expect(result.profitFactor).toBeCloseTo(2.0);
    });

    it('computes win rate correctly', () => {
      // 3 / 5 = 0.6
      expect(result.winningPercent).toBeCloseTo(0.6);
    });

    it('computes average win and average loss', () => {
      expect(result.averageWin).toBeCloseTo(200); // 600 / 3
      expect(result.averageLoss).toBeCloseTo(150); // 300 / 2
    });

    it('computes payoff ratio = averageWin / averageLoss', () => {
      // 200 / 150 ≈ 1.333
      expect(result.payoffRatio).toBeCloseTo(1.333, 2);
    });

    it('computes expectancy = (winRate × avgWin) - (lossRate × avgLoss)', () => {
      // (0.6 × 200) - (0.4 × 150) = 120 - 60 = 60
      expect(result.expectancy).toBeCloseTo(60);
    });

    it('computes largest win and largest loss', () => {
      expect(result.largestWin).toBeCloseTo(300);
      expect(result.largestLoss).toBeCloseTo(200);
    });

    it('computes median trade on the sorted PnL list', () => {
      // sorted: [-200, -100, 100, 200, 300] → median = 100
      expect(result.medianTrade).toBeCloseTo(100);
    });

    it('computes average trade = netProfit / totalTrades', () => {
      // 300 / 5 = 60
      expect(result.averageTrade).toBeCloseTo(60);
    });
  });

  // ── Recovery factor ────────────────────────────────────────────────────────

  it('computes recovery factor = netProfit / maxAbsoluteDrawdown', () => {
    const result = calculator.compute(
      [makeTrade(500)],
      10_000,
      10_500,
      START,
      END,
      1_000, // max absolute drawdown
    );
    // 500 / 1000 = 0.5
    expect(result.recoveryFactor).toBeCloseTo(0.5);
  });

  it('recovery factor is 0 when max drawdown is 0', () => {
    const result = calculator.compute([makeTrade(500)], 10_000, 10_500, START, END, 0);
    expect(result.recoveryFactor).toBe(0);
  });

  // ── Break-even trades ──────────────────────────────────────────────────────

  it('counts break-even trades', () => {
    const result = calculator.compute(
      [makeTrade(0), makeTrade(100), makeTrade(-100)],
      10_000,
      10_000,
      START,
      END,
    );
    expect(result.breakEvenTrades).toBe(1);
    expect(result.winningTrades).toBe(1);
    expect(result.losingTrades).toBe(1);
  });

  // ── Total return percent ───────────────────────────────────────────────────

  it('computes total return percent correctly', () => {
    const result = calculator.compute([], 10_000, 11_000, START, END);
    expect(result.totalReturnPercent).toBeCloseTo(10);
  });

  // ── Large dataset performance ──────────────────────────────────────────────

  it('handles 1000 trades without errors', () => {
    const largeTrades = Array.from({ length: 1000 }, (_, i) => makeTrade(i % 3 === 0 ? -50 : 100));
    const result = calculator.compute(largeTrades, 10_000, 15_000, START, END);
    expect(result.totalTrades).toBe(1000);
    expect(result.winningTrades).toBeGreaterThan(0);
    expect(result.losingTrades).toBeGreaterThan(0);
    expect(isFinite(result.profitFactor)).toBe(true);
  });
});
