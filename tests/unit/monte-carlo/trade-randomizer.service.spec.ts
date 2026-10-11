import { TradeRandomizerService } from '@modules/monte-carlo/application/trade-randomizer.service';
import { MonteCarloConfig } from '@modules/monte-carlo/domain/models/monte-carlo-config.model';
import { SimulationMethod } from '@modules/monte-carlo/domain/enums/simulation-method.enum';
import { TradeRecord } from '@modules/backtest/domain/models/trade-record.model';
import { SeededRandomGenerator } from '@shared/random/random-generator';
import { OrderSide } from '@modules/exchange/enums/order.enums';

function baseTrade(overrides: Partial<TradeRecord> = {}): TradeRecord {
  return {
    tradeId: 'trade-1',
    strategyId: 'strat-1',
    symbol: 'BTC/USDT',
    side: OrderSide.BUY,
    entryTime: 1_000,
    exitTime: 2_000,
    entryPrice: 50_000,
    exitPrice: 51_000,
    quantity: 1,
    grossPnl: 1_000,
    commission: 10,
    netPnl: 990,
    durationMs: 1_000,
    maePercent: 0.2,
    mfePercent: 2,
    entryOrderId: 'e1',
    exitOrderId: 'x1',
    ...overrides,
  };
}

function baseConfig(overrides: Partial<MonteCarloConfig> = {}): MonteCarloConfig {
  return {
    runId: 'test',
    simulationCount: 100,
    method: SimulationMethod.MONTE_CARLO_FULL,
    initialCapital: 10_000,
    startTime: 0,
    endTime: 365 * 24 * 3600 * 1_000,
    ruinThresholdPercent: 50,
    ...overrides,
  };
}

describe('TradeRandomizerService', () => {
  let service: TradeRandomizerService;

  beforeEach(() => {
    service = new TradeRandomizerService();
  });

  it('returns the original object unchanged when no perturbations are configured', () => {
    const trade = baseTrade();
    const config = baseConfig();
    const result = service.applyRandomization(trade, config, new SeededRandomGenerator(1));
    expect(result).toBe(trade); // same reference — no allocation
  });

  it('reduces netPnl when randomSlippage is applied', () => {
    const trade = baseTrade();
    const config = baseConfig({ randomSlippage: { minBps: 5, maxBps: 5 } });
    const result = service.applyRandomization(trade, config, new SeededRandomGenerator(1));
    // positionValue = 50_000 × 1 = 50_000; 5 bps = 0.05 % → 25 USDT cost
    expect(result.netPnl).toBeCloseTo(trade.netPnl - 25, 5);
  });

  it('replaces commission entirely when randomCommission is configured', () => {
    const trade = baseTrade();
    const config = baseConfig({ randomCommission: { minBps: 2, maxBps: 2 } });
    const result = service.applyRandomization(trade, config, new SeededRandomGenerator(1));
    // positionValue = 50_000; 2 bps → 10 USDT commission
    // netPnl = grossPnl − newCommission = 1_000 − 10 = 990
    expect(result.commission).toBeCloseTo(10, 5);
    expect(result.netPnl).toBeCloseTo(1_000 - 10, 5);
  });

  it('reduces netPnl when randomSpread is applied', () => {
    const trade = baseTrade();
    const config = baseConfig({ randomSpread: { minBps: 1, maxBps: 1 } });
    const result = service.applyRandomization(trade, config, new SeededRandomGenerator(1));
    // 1 bps of 50_000 = 5 USDT
    expect(result.netPnl).toBeCloseTo(trade.netPnl - 5, 5);
  });

  it('reduces netPnl when randomLatency is applied', () => {
    const trade = baseTrade();
    // 100 ms × 0.001 bps/ms = 0.1 bps → 0.1/10_000 × 50_000 = 0.5 USDT
    const config = baseConfig({ randomLatency: { minMs: 100, maxMs: 100 } });
    const result = service.applyRandomization(trade, config, new SeededRandomGenerator(1));
    expect(result.netPnl).toBeCloseTo(trade.netPnl - 0.5, 5);
  });

  it('all perturbations are additive and do not interfere', () => {
    const trade = baseTrade();
    const config = baseConfig({
      randomSlippage: { minBps: 5, maxBps: 5 }, // → 25 USDT
      randomCommission: { minBps: 2, maxBps: 2 }, // → replaces commission with 10 USDT
      randomSpread: { minBps: 1, maxBps: 1 }, // → 5 USDT
      randomLatency: { minMs: 100, maxMs: 100 }, // → 0.5 USDT
    });
    const result = service.applyRandomization(trade, config, new SeededRandomGenerator(1));

    // netPnl = grossPnl(1_000) − newCommission(10) − slippage(25) − spread(5) − latency(0.5)
    expect(result.netPnl).toBeCloseTo(1_000 - 10 - 25 - 5 - 0.5, 3);
  });

  it('returns original when positionValue is zero', () => {
    const trade = baseTrade({ entryPrice: 0 });
    const config = baseConfig({ randomSlippage: { minBps: 5, maxBps: 10 } });
    const result = service.applyRandomization(trade, config, new SeededRandomGenerator(1));
    expect(result).toBe(trade);
  });

  it('never mutates the original trade object', () => {
    const trade = baseTrade();
    const original = { ...trade };
    const config = baseConfig({ randomSlippage: { minBps: 5, maxBps: 10 } });
    service.applyRandomization(trade, config, new SeededRandomGenerator(1));
    expect(trade.netPnl).toBe(original.netPnl);
    expect(trade.commission).toBe(original.commission);
  });
});
