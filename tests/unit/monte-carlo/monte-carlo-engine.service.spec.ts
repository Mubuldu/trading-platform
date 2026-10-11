import { Test, TestingModule } from '@nestjs/testing';
import { MonteCarloEngineService } from '@modules/monte-carlo/application/monte-carlo-engine.service';
import { BootstrapResamplerService } from '@modules/monte-carlo/application/bootstrap-resampler.service';
import { TradeRandomizerService } from '@modules/monte-carlo/application/trade-randomizer.service';
import { SimulationRunnerService } from '@modules/monte-carlo/application/simulation-runner.service';
import { StatisticsAggregatorService } from '@modules/monte-carlo/application/statistics-aggregator.service';
import { RobustnessScorerService } from '@modules/monte-carlo/application/robustness-scorer.service';
import { MonteCarloConfig } from '@modules/monte-carlo/domain/models/monte-carlo-config.model';
import { SimulationMethod } from '@modules/monte-carlo/domain/enums/simulation-method.enum';
import { TradeRecord } from '@modules/backtest/domain/models/trade-record.model';
import { OrderSide } from '@modules/exchange/enums/order.enums';
import { AppLoggerService } from '@core/logging/app-logger.service';

const ONE_YEAR_MS = 365.25 * 24 * 3600 * 1_000;

function makeTrade(id: string, netPnl: number, qty = 1, price = 100): TradeRecord {
  return {
    tradeId: id,
    strategyId: 's',
    symbol: 'BTC/USDT',
    side: OrderSide.BUY,
    entryTime: 0,
    exitTime: 1_000,
    entryPrice: price,
    exitPrice: price + netPnl / qty,
    quantity: qty,
    grossPnl: netPnl + qty,
    commission: qty,
    netPnl,
    durationMs: 1_000,
    maePercent: 0.1,
    mfePercent: 1,
    entryOrderId: `e-${id}`,
    exitOrderId: `x-${id}`,
  };
}

function makeConfig(overrides: Partial<MonteCarloConfig> = {}): MonteCarloConfig {
  return {
    runId: 'mc-test',
    simulationCount: 100,
    method: SimulationMethod.BOOTSTRAP_RESAMPLING,
    initialCapital: 10_000,
    startTime: 0,
    endTime: ONE_YEAR_MS,
    ruinThresholdPercent: 50,
    seed: 42,
    ...overrides,
  };
}

describe('MonteCarloEngineService', () => {
  let engine: MonteCarloEngineService;

  const loggerMock: Partial<AppLoggerService> = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MonteCarloEngineService,
        BootstrapResamplerService,
        TradeRandomizerService,
        SimulationRunnerService,
        StatisticsAggregatorService,
        RobustnessScorerService,
        { provide: AppLoggerService, useValue: loggerMock },
      ],
    }).compile();

    engine = module.get(MonteCarloEngineService);
  });

  // ── Empty trades ──────────────────────────────────────────────────────────

  describe('empty trade list', () => {
    it('returns an empty result without throwing', () => {
      const result = engine.run([], makeConfig());
      expect(result.simulationCount).toBe(0);
      expect(result.probabilityOfRuin).toBe(0);
      expect(result.robustnessGrade).toBe('DANGEROUS');
    });

    it('logs a warning for empty trades', () => {
      engine.run([], makeConfig());
      expect(loggerMock.warn).toHaveBeenCalled();
    });
  });

  // ── Known-dataset tests ───────────────────────────────────────────────────

  describe('known dataset — all winning trades', () => {
    const trades = Array.from({ length: 20 }, (_, i) => makeTrade(`t${i}`, 50));

    it('produces simulationCount results', () => {
      const result = engine.run(trades, makeConfig({ simulationCount: 50 }));
      expect(result.simulationCount).toBe(50);
    });

    it('probability of ruin is 0 for modest winners', () => {
      const result = engine.run(trades, makeConfig({ ruinThresholdPercent: 50 }));
      expect(result.probabilityOfRuin).toBe(0);
    });

    it('median return is positive', () => {
      const result = engine.run(trades, makeConfig());
      expect(result.returnDistribution.median).toBeGreaterThan(0);
    });

    it('assigns ROBUST or MODERATE grade', () => {
      const result = engine.run(trades, makeConfig({ simulationCount: 200 }));
      expect(['ROBUST', 'MODERATE']).toContain(result.robustnessGrade);
    });
  });

  describe('known dataset — all losing trades', () => {
    const trades = Array.from({ length: 20 }, (_, i) => makeTrade(`t${i}`, -400));

    it('has high probability of ruin', () => {
      const result = engine.run(
        trades,
        makeConfig({ simulationCount: 200, ruinThresholdPercent: 50 }),
      );
      expect(result.probabilityOfRuin).toBeGreaterThan(0.5);
    });

    it('assigns FRAGILE or DANGEROUS grade', () => {
      const result = engine.run(trades, makeConfig({ simulationCount: 200 }));
      expect(['FRAGILE', 'DANGEROUS']).toContain(result.robustnessGrade);
      expect(result.isFragile).toBe(true);
    });
  });

  // ── Determinism with seed ─────────────────────────────────────────────────

  describe('determinism', () => {
    it('produces identical results for the same seed', () => {
      const trades = Array.from({ length: 10 }, (_, i) =>
        makeTrade(`t${i}`, i % 3 === 0 ? -100 : 80),
      );

      const r1 = engine.run(trades, makeConfig({ seed: 7 }));
      const r2 = engine.run(trades, makeConfig({ seed: 7 }));

      expect(r1.returnDistribution.median).toBeCloseTo(r2.returnDistribution.median, 6);
      expect(r1.probabilityOfRuin).toBe(r2.probabilityOfRuin);
      expect(r1.robustnessScore).toBe(r2.robustnessScore);
    });

    it('produces different results for different seeds', () => {
      // Use a high-variance trade set so different seeds yield statistically
      // distinguishable distributions over 500 simulations.
      const trades = Array.from({ length: 30 }, (_, i) =>
        makeTrade(`t${i}`, i % 3 === 0 ? -600 : i % 3 === 1 ? 300 : 100),
      );

      const r1 = engine.run(trades, makeConfig({ simulationCount: 500, seed: 1 }));
      const r2 = engine.run(trades, makeConfig({ simulationCount: 500, seed: 9999 }));

      // At least one of these metrics should differ between different seeds.
      const differs =
        r1.returnDistribution.p5 !== r2.returnDistribution.p5 ||
        r1.returnDistribution.p95 !== r2.returnDistribution.p95 ||
        r1.probabilityOfRuin !== r2.probabilityOfRuin;
      expect(differs).toBe(true);
    });
  });

  // ── Simulation methods ────────────────────────────────────────────────────

  describe('RANDOM_TRADE_ORDER method', () => {
    it('runs without error', () => {
      const trades = Array.from({ length: 10 }, (_, i) => makeTrade(`t${i}`, i * 20 - 50));
      const result = engine.run(
        trades,
        makeConfig({ method: SimulationMethod.RANDOM_TRADE_ORDER }),
      );
      expect(result.simulationCount).toBe(100);
    });
  });

  describe('MONTE_CARLO_FULL method with cost perturbation', () => {
    it('runs without error and produces lower p5 return than base (heavy costs eat tail)', () => {
      // Use large position sizes so the bps perturbations have a meaningful impact.
      const bigTrades = Array.from(
        { length: 20 },
        (_, i) => makeTrade(`t${i}`, 100, 1, 50_000), // price=50_000 → 50 bps = $250 cost each
      );
      const baseResult = engine.run(bigTrades, makeConfig({ simulationCount: 500 }));
      const fullResult = engine.run(
        bigTrades,
        makeConfig({
          simulationCount: 500,
          method: SimulationMethod.MONTE_CARLO_FULL,
          randomSlippage: { minBps: 5, maxBps: 10 },
          randomCommission: { minBps: 3, maxBps: 5 },
          randomSpread: { minBps: 2, maxBps: 4 },
          seed: 42,
        }),
      );
      // Additional costs must reduce at least the 5th-percentile outcome.
      expect(fullResult.returnDistribution.p5).toBeLessThan(baseResult.returnDistribution.p5);
    });
  });

  // ── Statistical outputs ───────────────────────────────────────────────────

  describe('statistical outputs', () => {
    const trades = Array.from({ length: 30 }, (_, i) =>
      makeTrade(`t${i}`, i % 3 === 0 ? -200 : 120),
    );

    it('VaR95 is at most the median return', () => {
      const result = engine.run(trades, makeConfig({ simulationCount: 500 }));
      expect(result.var95).toBeLessThanOrEqual(result.returnDistribution.median);
    });

    it('CVaR95 is at most VaR95', () => {
      const result = engine.run(trades, makeConfig({ simulationCount: 500 }));
      expect(result.cvar95).toBeLessThanOrEqual(result.var95);
    });

    it('confidenceInterval95 lower < upper', () => {
      const result = engine.run(trades, makeConfig({ simulationCount: 200 }));
      expect(result.confidenceInterval95Return[0]).toBeLessThanOrEqual(
        result.confidenceInterval95Return[1],
      );
    });

    it('worstCase return ≤ medianCase return ≤ bestCase return', () => {
      const result = engine.run(trades, makeConfig({ simulationCount: 200 }));
      expect(result.worstCase.totalReturnPercent).toBeLessThanOrEqual(
        result.medianCase.totalReturnPercent,
      );
      expect(result.medianCase.totalReturnPercent).toBeLessThanOrEqual(
        result.bestCase.totalReturnPercent,
      );
    });

    it('return, drawdown, and finalEquity histograms are non-empty', () => {
      const result = engine.run(trades, makeConfig({ simulationCount: 100 }));
      expect(result.returnHistogram.length).toBeGreaterThan(0);
      expect(result.drawdownHistogram.length).toBeGreaterThan(0);
      expect(result.finalEquityHistogram.length).toBeGreaterThan(0);
    });
  });

  // ── Large dataset performance ─────────────────────────────────────────────

  describe('large dataset', () => {
    it('completes 1000 simulations of 500 trades in under 2 s', () => {
      const trades = Array.from({ length: 500 }, (_, i) =>
        makeTrade(`t${i}`, i % 4 === 0 ? -150 : 80),
      );
      const start = Date.now();
      engine.run(trades, makeConfig({ simulationCount: 1_000, seed: 1 }));
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(2_000);
    });
  });
});
