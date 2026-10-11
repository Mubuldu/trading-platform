import { SimulationRunnerService } from '@modules/monte-carlo/application/simulation-runner.service';
import { MonteCarloConfig } from '@modules/monte-carlo/domain/models/monte-carlo-config.model';
import { SimulationMethod } from '@modules/monte-carlo/domain/enums/simulation-method.enum';
import { TradeRecord } from '@modules/backtest/domain/models/trade-record.model';
import { OrderSide } from '@modules/exchange/enums/order.enums';

const ONE_YEAR_MS = 365.25 * 24 * 3600 * 1_000;

function makeTrade(id: string, netPnl: number, qty = 1, price = 100): TradeRecord {
  return {
    tradeId: id,
    strategyId: 's',
    symbol: 'BTC/USDT',
    side: OrderSide.BUY,
    entryTime: 0,
    exitTime: 1,
    entryPrice: price,
    exitPrice: price + netPnl / qty,
    quantity: qty,
    grossPnl: netPnl + 1,
    commission: 1,
    netPnl,
    durationMs: 1,
    maePercent: 0.1,
    mfePercent: 1,
    entryOrderId: `e-${id}`,
    exitOrderId: `x-${id}`,
  };
}

function config(overrides: Partial<MonteCarloConfig> = {}): MonteCarloConfig {
  return {
    runId: 'r',
    simulationCount: 1,
    method: SimulationMethod.BOOTSTRAP_RESAMPLING,
    initialCapital: 10_000,
    startTime: 0,
    endTime: ONE_YEAR_MS,
    ruinThresholdPercent: 50,
    ...overrides,
  };
}

describe('SimulationRunnerService', () => {
  let service: SimulationRunnerService;

  beforeEach(() => {
    service = new SimulationRunnerService();
  });

  it('returns initial equity with zero metrics when trades list is empty', () => {
    const result = service.run(0, [], config());
    expect(result.finalEquity).toBe(10_000);
    expect(result.totalReturnPercent).toBe(0);
    expect(result.maxDrawdownPercent).toBe(0);
    expect(result.isRuin).toBe(false);
    expect(result.tradeCount).toBe(0);
  });

  it('correctly tracks final equity from winning trades', () => {
    const trades = [makeTrade('a', 500), makeTrade('b', 300)];
    const result = service.run(0, trades, config());
    expect(result.finalEquity).toBeCloseTo(10_800, 2);
    expect(result.totalReturnPercent).toBeCloseTo(8, 2);
    expect(result.isRuin).toBe(false);
  });

  it('correctly tracks final equity with mixed trades', () => {
    const trades = [makeTrade('a', 500), makeTrade('b', -200)];
    const result = service.run(0, trades, config());
    expect(result.finalEquity).toBeCloseTo(10_300, 2);
    expect(result.totalReturnPercent).toBeCloseTo(3, 2);
  });

  it('detects ruin when equity falls below threshold', () => {
    // Initial capital 10_000; ruin at 50 % drop → 5_000
    // One trade losing 5_001 should trigger ruin.
    const trades = [makeTrade('big-loss', -5_001)];
    const result = service.run(0, trades, config({ ruinThresholdPercent: 50 }));
    expect(result.isRuin).toBe(true);
  });

  it('stops processing trades after ruin', () => {
    const trades = [
      makeTrade('big-loss', -6_000),
      makeTrade('win', 1_000),
      makeTrade('win2', 1_000),
    ];
    const result = service.run(0, trades, config({ ruinThresholdPercent: 50 }));
    expect(result.isRuin).toBe(true);
    // tradeCount reflects trades processed up to and including the ruin trade.
    expect(result.tradeCount).toBe(1);
  });

  it('computes maxDrawdownPercent correctly', () => {
    // Equity: 10_000 → 11_000 → 8_000 → 9_000
    const trades = [makeTrade('up', 1_000), makeTrade('down', -3_000), makeTrade('up2', 1_000)];
    const result = service.run(0, trades, config());
    // Peak = 11_000; trough = 8_000 → DD = 3/11 ≈ 27.27 %
    expect(result.maxDrawdownPercent).toBeCloseTo((3_000 / 11_000) * 100, 2);
  });

  it('equity curve first point is initialCapital and length is bounded', () => {
    const trades = Array.from({ length: 200 }, (_, i) => makeTrade(`t${i}`, 10));
    const result = service.run(0, trades, config());
    expect(result.equityCurve[0]).toBe(10_000);
    expect(result.equityCurve.length).toBeLessThanOrEqual(100);
    expect(result.equityCurve[result.equityCurve.length - 1]).toBeCloseTo(result.finalEquity, 2);
  });

  it('computes positive Sharpe ratio for a pure-win sequence', () => {
    const trades = Array.from({ length: 50 }, (_, i) => makeTrade(`t${i}`, 100));
    const result = service.run(0, trades, config());
    expect(result.sharpeRatio).toBeGreaterThan(0);
  });

  it('computes CAGR = 0 when startTime equals endTime', () => {
    const trades = [makeTrade('t', 500)];
    const result = service.run(0, trades, config({ startTime: 0, endTime: 0 }));
    expect(result.cagrPercent).toBe(0);
  });

  it('caps equity at zero (no negative equity)', () => {
    const trades = [makeTrade('t', -100_000)]; // far exceeds capital
    const result = service.run(0, trades, config());
    expect(result.finalEquity).toBeGreaterThanOrEqual(0);
  });
});
