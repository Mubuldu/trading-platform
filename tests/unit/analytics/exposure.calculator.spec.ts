import { ExposureCalculator } from '@modules/analytics/application/calculators/exposure.calculator';
import { AnalyticsPositionSnapshot } from '@modules/analytics/domain/models/analytics-trade.model';

describe('ExposureCalculator', () => {
  let calculator: ExposureCalculator;

  beforeEach(() => {
    calculator = new ExposureCalculator();
  });

  const makePosition = (
    symbol: string,
    direction: 'LONG' | 'SHORT',
    notional: number,
    strategyId = 'strat_a',
    exchangeId = 'paper_trading',
  ): AnalyticsPositionSnapshot => ({
    positionId: `pos_${symbol}`,
    strategyId,
    symbol,
    exchangeId,
    direction,
    quantity: notional / 40_000,
    averageEntryPrice: 40_000,
    notional,
    unrealizedPnl: notional * 0.01,
  });

  // ── Empty positions ────────────────────────────────────────────────────────

  it('returns all zeros for empty positions', () => {
    const result = calculator.compute([], 10_000);
    expect(result.grossExposure).toBe(0);
    expect(result.netExposure).toBe(0);
    expect(result.longExposure).toBe(0);
    expect(result.shortExposure).toBe(0);
    expect(result.longPositionCount).toBe(0);
    expect(result.shortPositionCount).toBe(0);
    expect(result.totalPositionCount).toBe(0);
    expect(Object.keys(result.bySymbol)).toHaveLength(0);
  });

  // ── Long-only ─────────────────────────────────────────────────────────────

  describe('long-only portfolio', () => {
    it('computes gross and net exposure correctly', () => {
      const positions = [
        makePosition('BTC/USDT', 'LONG', 5_000),
        makePosition('ETH/USDT', 'LONG', 3_000),
      ];
      const result = calculator.compute(positions, 10_000);
      expect(result.longExposure).toBeCloseTo(8_000);
      expect(result.shortExposure).toBe(0);
      expect(result.grossExposure).toBeCloseTo(8_000);
      expect(result.netExposure).toBeCloseTo(8_000);
      expect(result.longPositionCount).toBe(2);
      expect(result.shortPositionCount).toBe(0);
    });
  });

  // ── Short-only ────────────────────────────────────────────────────────────

  describe('short-only portfolio', () => {
    it('has negative net exposure', () => {
      const positions = [makePosition('BTC/USDT', 'SHORT', 4_000)];
      const result = calculator.compute(positions, 10_000);
      expect(result.shortExposure).toBeCloseTo(4_000);
      expect(result.longExposure).toBe(0);
      expect(result.grossExposure).toBeCloseTo(4_000);
      expect(result.netExposure).toBeCloseTo(-4_000);
    });
  });

  // ── Mixed long/short ───────────────────────────────────────────────────────

  describe('mixed long/short portfolio', () => {
    it('computes gross = sum of all notionals, net = long - short', () => {
      const positions = [
        makePosition('BTC/USDT', 'LONG', 6_000),
        makePosition('ETH/USDT', 'SHORT', 4_000),
      ];
      const result = calculator.compute(positions, 10_000);
      expect(result.grossExposure).toBeCloseTo(10_000);
      expect(result.netExposure).toBeCloseTo(2_000); // 6000 - 4000
    });
  });

  // ── By symbol breakdown ────────────────────────────────────────────────────

  describe('bySymbol', () => {
    it('populates bySymbol correctly', () => {
      const positions = [makePosition('BTC/USDT', 'LONG', 5_000)];
      const result = calculator.compute(positions, 10_000);
      expect(result.bySymbol['BTC/USDT']).toBeDefined();
      expect(result.bySymbol['BTC/USDT']!.notional).toBeCloseTo(5_000);
      expect(result.bySymbol['BTC/USDT']!.direction).toBe('LONG');
      expect(result.bySymbol['BTC/USDT']!.percentOfEquity).toBeCloseTo(0.5); // 5000/10000
    });
  });

  // ── By strategy breakdown ──────────────────────────────────────────────────

  describe('byStrategy', () => {
    it('aggregates positions by strategyId', () => {
      const positions = [
        makePosition('BTC/USDT', 'LONG', 4_000, 'strategy_a'),
        makePosition('ETH/USDT', 'LONG', 3_000, 'strategy_a'),
        makePosition('SOL/USDT', 'LONG', 2_000, 'strategy_b'),
      ];
      const result = calculator.compute(positions, 10_000);
      expect(result.byStrategy['strategy_a']!.notional).toBeCloseTo(7_000);
      expect(result.byStrategy['strategy_a']!.positionCount).toBe(2);
      expect(result.byStrategy['strategy_b']!.notional).toBeCloseTo(2_000);
      expect(result.byStrategy['strategy_b']!.positionCount).toBe(1);
    });
  });

  // ── By exchange breakdown ──────────────────────────────────────────────────

  describe('byExchange', () => {
    it('aggregates positions by exchangeId', () => {
      const positions = [
        makePosition('BTC/USDT', 'LONG', 5_000, 'strat', 'binance'),
        makePosition('ETH/USDT', 'LONG', 3_000, 'strat', 'paper_trading'),
      ];
      const result = calculator.compute(positions, 10_000);
      expect(result.byExchange['binance']!.notional).toBeCloseTo(5_000);
      expect(result.byExchange['paper_trading']!.notional).toBeCloseTo(3_000);
    });
  });

  // ── Percent of equity ──────────────────────────────────────────────────────

  it('computes percentOfEquity correctly relative to totalEquity', () => {
    const positions = [makePosition('BTC/USDT', 'LONG', 2_000)];
    const result = calculator.compute(positions, 8_000);
    // 2000 / 8000 = 0.25
    expect(result.bySymbol['BTC/USDT']!.percentOfEquity).toBeCloseTo(0.25);
  });

  it('handles zero equity gracefully', () => {
    const positions = [makePosition('BTC/USDT', 'LONG', 1_000)];
    expect(() => calculator.compute(positions, 0)).not.toThrow();
    const result = calculator.compute(positions, 0);
    expect(result.bySymbol['BTC/USDT']!.percentOfEquity).toBe(0);
  });
});
