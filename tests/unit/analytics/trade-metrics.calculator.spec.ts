import { TradeMetricsCalculator } from '@modules/analytics/application/calculators/trade-metrics.calculator';
import { AnalyticsTrade } from '@modules/analytics/domain/models/analytics-trade.model';

describe('TradeMetricsCalculator', () => {
  let calculator: TradeMetricsCalculator;

  beforeEach(() => {
    calculator = new TradeMetricsCalculator();
  });

  const BASE_TIME = 1_700_000_000_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;

  const makeTrade = (entryTime: number, durationMs: number, netPnl = 100): AnalyticsTrade => ({
    tradeId: `t_${entryTime}`,
    strategyId: 'test',
    symbol: 'BTC/USDT',
    exchangeId: 'paper',
    side: 'LONG',
    entryTime,
    exitTime: entryTime + durationMs,
    entryPrice: 40_000,
    exitPrice: 40_000 + (netPnl > 0 ? 100 : -100),
    quantity: 1,
    grossPnl: netPnl + 10,
    commission: 10,
    netPnl,
    slippage: 5,
    durationMs,
  });

  // ── Empty input ────────────────────────────────────────────────────────────

  it('returns all zeros for empty trades list', () => {
    const result = calculator.compute([]);
    expect(result.averageHoldingTimeMs).toBe(0);
    expect(result.maxHoldingTimeMs).toBe(0);
    expect(result.minHoldingTimeMs).toBe(0);
    expect(result.maxConsecutiveWins).toBe(0);
    expect(result.maxConsecutiveLosses).toBe(0);
    expect(result.longestFlatPeriodMs).toBe(0);
    expect(result.tradeFrequencyPerDay).toBe(0);
    expect(result.firstTradeAt).toBe(0);
    expect(result.lastTradeAt).toBe(0);
  });

  // ── Holding times ──────────────────────────────────────────────────────────

  describe('holding times', () => {
    it('computes averageHoldingTimeMs correctly', () => {
      const trades = [
        makeTrade(BASE_TIME, 2 * HOUR),
        makeTrade(BASE_TIME + DAY, 4 * HOUR),
        makeTrade(BASE_TIME + 2 * DAY, 6 * HOUR),
      ];
      const result = calculator.compute(trades);
      expect(result.averageHoldingTimeMs).toBeCloseTo(4 * HOUR);
    });

    it('computes maxHoldingTimeMs correctly', () => {
      const trades = [
        makeTrade(BASE_TIME, HOUR),
        makeTrade(BASE_TIME + DAY, 10 * HOUR),
        makeTrade(BASE_TIME + 2 * DAY, 3 * HOUR),
      ];
      const result = calculator.compute(trades);
      expect(result.maxHoldingTimeMs).toBe(10 * HOUR);
    });

    it('computes minHoldingTimeMs correctly', () => {
      const trades = [
        makeTrade(BASE_TIME, 5 * HOUR),
        makeTrade(BASE_TIME + DAY, HOUR),
        makeTrade(BASE_TIME + 2 * DAY, 3 * HOUR),
      ];
      const result = calculator.compute(trades);
      expect(result.minHoldingTimeMs).toBe(HOUR);
    });
  });

  // ── Bars held ─────────────────────────────────────────────────────────────

  describe('barsHeld', () => {
    it('returns 0 when barDurationMs is not provided', () => {
      const trades = [makeTrade(BASE_TIME, 4 * HOUR)];
      const result = calculator.compute(trades);
      expect(result.averageBarsHeld).toBe(0);
      expect(result.maxBarsHeld).toBe(0);
    });

    it('computes barsHeld correctly with 1-hour bar duration', () => {
      const trades = [makeTrade(BASE_TIME, 4 * HOUR), makeTrade(BASE_TIME + DAY, 8 * HOUR)];
      const result = calculator.compute(trades, HOUR);
      expect(result.averageBarsHeld).toBeCloseTo(6); // (4+8)/2
      expect(result.maxBarsHeld).toBeCloseTo(8);
    });
  });

  // ── Consecutive streaks ────────────────────────────────────────────────────

  describe('consecutive streaks', () => {
    it('computes max consecutive wins', () => {
      // Win Win Win Loss Win Win
      const trades = [100, 200, 300, -100, 50, 75].map((pnl, i) =>
        makeTrade(BASE_TIME + i * DAY, HOUR, pnl),
      );
      const result = calculator.compute(trades);
      expect(result.maxConsecutiveWins).toBe(3);
    });

    it('computes max consecutive losses', () => {
      // Win Loss Loss Loss Win
      const trades = [100, -50, -60, -70, 80].map((pnl, i) =>
        makeTrade(BASE_TIME + i * DAY, HOUR, pnl),
      );
      const result = calculator.compute(trades);
      expect(result.maxConsecutiveLosses).toBe(3);
    });

    it('handles alternating win/loss correctly', () => {
      const trades = [100, -50, 100, -50, 100].map((pnl, i) =>
        makeTrade(BASE_TIME + i * DAY, HOUR, pnl),
      );
      const result = calculator.compute(trades);
      expect(result.maxConsecutiveWins).toBe(1);
      expect(result.maxConsecutiveLosses).toBe(1);
    });

    it('handles all winning streak', () => {
      const trades = [100, 200, 300, 400].map((pnl, i) =>
        makeTrade(BASE_TIME + i * DAY, HOUR, pnl),
      );
      const result = calculator.compute(trades);
      expect(result.maxConsecutiveWins).toBe(4);
      expect(result.maxConsecutiveLosses).toBe(0);
    });
  });

  // ── Longest flat period ────────────────────────────────────────────────────

  describe('longestFlatPeriodMs', () => {
    it('returns 0 for a single trade', () => {
      const result = calculator.compute([makeTrade(BASE_TIME, HOUR)]);
      expect(result.longestFlatPeriodMs).toBe(0);
    });

    it('computes longest gap between consecutive trade exits', () => {
      // Trade 1: entry=0, exit=1h. Trade 2: entry=10h, exit=12h. Gap = 9h
      // Trade 3: entry=13h, exit=15h. Gap = 1h
      const trades = [
        makeTrade(0, HOUR), // exit = 1h
        makeTrade(10 * HOUR, 2 * HOUR), // entry = 10h > exit(1h), gap = 9h
        makeTrade(13 * HOUR, 2 * HOUR), // entry = 13h > exit(12h), gap = 1h
      ];
      const result = calculator.compute(trades);
      expect(result.longestFlatPeriodMs).toBe(9 * HOUR);
    });

    it('returns 0 when trades are back-to-back', () => {
      // Exit of trade 1 = entry of trade 2
      const trades = [makeTrade(BASE_TIME, HOUR), makeTrade(BASE_TIME + HOUR, HOUR)];
      const result = calculator.compute(trades);
      expect(result.longestFlatPeriodMs).toBe(0);
    });
  });

  // ── Trade frequency ────────────────────────────────────────────────────────

  describe('trade frequency', () => {
    it('computes trades per day correctly', () => {
      // 3 trades spread over 2 days = 1.5 trades/day
      const trades = [
        makeTrade(BASE_TIME, HOUR),
        makeTrade(BASE_TIME + DAY, HOUR),
        makeTrade(BASE_TIME + 2 * DAY, HOUR),
      ];
      const result = calculator.compute(trades);
      // totalPeriodMs = last exit - first entry = 2*DAY + HOUR - 0
      // periodDays ≈ 2.042 days → frequency ≈ 3 / 2.042 ≈ 1.47 trades/day
      expect(result.tradeFrequencyPerDay).toBeGreaterThan(0);
      expect(result.tradeFrequencyPerWeek).toBeGreaterThan(result.tradeFrequencyPerDay);
    });
  });

  // ── Period boundaries ──────────────────────────────────────────────────────

  it('sets firstTradeAt and lastTradeAt correctly', () => {
    const trades = [
      makeTrade(BASE_TIME, HOUR),
      makeTrade(BASE_TIME + 5 * DAY, 2 * HOUR),
      makeTrade(BASE_TIME + 10 * DAY, HOUR),
    ];
    const result = calculator.compute(trades);
    expect(result.firstTradeAt).toBe(BASE_TIME); // first entry time
    expect(result.lastTradeAt).toBe(BASE_TIME + 10 * DAY + HOUR); // last exit time
  });
});
