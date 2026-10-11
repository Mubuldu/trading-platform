import { BootstrapResamplerService } from '@modules/monte-carlo/application/bootstrap-resampler.service';
import { TradeRecord } from '@modules/backtest/domain/models/trade-record.model';
import { SeededRandomGenerator } from '@shared/random/random-generator';
import { OrderSide } from '@modules/exchange/enums/order.enums';

function makeTrade(id: string, netPnl: number): TradeRecord {
  return {
    tradeId: id,
    strategyId: 'strat-1',
    symbol: 'BTC/USDT',
    side: OrderSide.BUY,
    entryTime: 1_000_000,
    exitTime: 2_000_000,
    entryPrice: 50_000,
    exitPrice: 51_000,
    quantity: 0.1,
    grossPnl: netPnl + 1,
    commission: 1,
    netPnl,
    durationMs: 1_000_000,
    maePercent: 0.5,
    mfePercent: 2,
    entryOrderId: `entry-${id}`,
    exitOrderId: `exit-${id}`,
  };
}

describe('BootstrapResamplerService', () => {
  let service: BootstrapResamplerService;

  beforeEach(() => {
    service = new BootstrapResamplerService();
  });

  describe('resample', () => {
    it('returns an empty array when the input is empty', () => {
      const rng = new SeededRandomGenerator(42);
      expect(service.resample([], rng)).toEqual([]);
    });

    it('preserves the original trade count', () => {
      const trades = [makeTrade('t1', 100), makeTrade('t2', -50), makeTrade('t3', 200)];
      const rng = new SeededRandomGenerator(1);
      const result = service.resample(trades, rng);
      expect(result).toHaveLength(trades.length);
    });

    it('only draws from the source array', () => {
      const trades = [makeTrade('t1', 100), makeTrade('t2', -50), makeTrade('t3', 200)];
      const ids = new Set(trades.map((t) => t.tradeId));
      const rng = new SeededRandomGenerator(7);
      const result = service.resample(trades, rng);
      for (const t of result) {
        expect(ids.has(t.tradeId)).toBe(true);
      }
    });

    it('produces different results for different seeds', () => {
      const trades = Array.from({ length: 10 }, (_, i) => makeTrade(`t${i}`, i * 10));

      const result1 = service.resample(trades, new SeededRandomGenerator(1));
      const result2 = service.resample(trades, new SeededRandomGenerator(99));

      const ids1 = result1.map((t) => t.tradeId).join(',');
      const ids2 = result2.map((t) => t.tradeId).join(',');
      // With 10 trades and 10 draws the probability of identical sequences is negligibly small.
      expect(ids1).not.toBe(ids2);
    });

    it('produces the same sequence for the same seed (determinism)', () => {
      const trades = Array.from({ length: 5 }, (_, i) => makeTrade(`t${i}`, i));

      const r1 = service.resample(trades, new SeededRandomGenerator(42));
      const r2 = service.resample(trades, new SeededRandomGenerator(42));

      expect(r1.map((t) => t.tradeId)).toEqual(r2.map((t) => t.tradeId));
    });

    it('allows duplicates (sampling WITH replacement)', () => {
      const trades = [makeTrade('only', 100)];
      const rng = new SeededRandomGenerator(0);
      // Single-trade source → every draw must be that trade.
      const result = service.resample(trades, rng);
      expect(result).toHaveLength(1);
      expect(result[0].tradeId).toBe('only');
    });

    it('does not mutate the original array', () => {
      const trades = [makeTrade('t1', 100), makeTrade('t2', 200)];
      const original = trades.map((t) => t.tradeId);
      service.resample(trades, new SeededRandomGenerator(1));
      expect(trades.map((t) => t.tradeId)).toEqual(original);
    });
  });
});
