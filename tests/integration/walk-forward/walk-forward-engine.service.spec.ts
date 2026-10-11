import { BacktestEngineService } from '@modules/backtest/application/engine/backtest-engine.service';
import { BacktestRiskEvaluator } from '@modules/backtest/application/engine/backtest-risk-evaluator';
import { ExecutionSimulatorService } from '@modules/backtest/application/execution-simulator/execution-simulator.service';
import { OrderQueueService } from '@modules/backtest/application/execution-simulator/order-queue.service';
import { BacktestPortfolioTrackerService } from '@modules/backtest/application/portfolio/backtest-portfolio-tracker.service';
import { EquityCurveBuilderService } from '@modules/backtest/application/portfolio/equity-curve-builder.service';
import { ReportGeneratorService } from '@modules/backtest/application/reports/report-generator.service';
import { DrawdownCalculatorService } from '@modules/backtest/application/reports/statistics/drawdown-calculator.service';
import { PerformanceCalculatorService } from '@modules/backtest/application/reports/statistics/performance-calculator.service';
import { RiskMetricsCalculatorService } from '@modules/backtest/application/reports/statistics/risk-metrics-calculator.service';
import { ReplayEngineService } from '@modules/backtest/application/replay/replay-engine.service';
import { DataSourceType } from '@modules/backtest/domain/enums/data-source-type.enum';
import { Candle } from '@modules/indicator/domain/models/candle.model';
import { Timeframe } from '@modules/indicator/domain/enums/timeframe.enum';
import {
  IStrategy,
  StrategyContext,
  StrategyPluginConfig,
  StrategyHealth,
  StrategyMetrics,
} from '@modules/strategy/interfaces/strategy.interface';
import { StrategyState } from '@modules/strategy/domain/enums/strategy-state.enum';
import { Signal } from '@modules/strategy/interfaces/signal.interface';
import { SignalDirection } from '@modules/strategy/domain/enums/signal-direction.enum';
import { ok } from '@common/result';

import { WalkForwardEngineService } from '@modules/walk-forward/application/walk-forward-engine.service';
import { ParameterOptimizerService } from '@modules/walk-forward/application/parameter-optimizer.service';
import { ParameterStabilityAnalyzerService } from '@modules/walk-forward/application/parameter-stability-analyzer.service';
import { WalkForwardReportGeneratorService } from '@modules/walk-forward/application/walk-forward-report-generator.service';
import { WindowGeneratorService } from '@modules/walk-forward/application/window-generator.service';
import { OptimizationMetric } from '@modules/walk-forward/domain/enums/optimization-metric.enum';
import { WindowType } from '@modules/walk-forward/domain/enums/window-type.enum';
import { WalkForwardConfig } from '@modules/walk-forward/domain/models/walk-forward-config.model';

// ─── Constants ────────────────────────────────────────────────────────────────

const BAR_MS = 3_600_000;
const STRATEGY_ID = 'wf-test-strategy';

const mockLogger = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
} as any;

// ─── Candle factories ─────────────────────────────────────────────────────────

function makeCandle(index: number, open: number, close: number): Candle {
  return {
    symbol: 'BTC/USDT',
    exchange: 'test',
    timeframe: Timeframe.ONE_HOUR,
    openTime: BAR_MS * index,
    closeTime: BAR_MS * index + BAR_MS - 1,
    open,
    high: Math.max(open, close) + 50,
    low: Math.min(open, close) - 50,
    close,
    volume: 1000,
    isClosed: true,
  };
}

/** 100 uptrending candles: price rises $100 per bar */
function makeUptrendCandles(count = 100): Candle[] {
  return Array.from({ length: count }, (_, i) =>
    makeCandle(i + 1, 50_000 + i * 100, 50_100 + i * 100),
  );
}

/** 100 candles that reverse after the midpoint: uptrend then downtrend */
function makeMixedCandles(count = 100): Candle[] {
  const mid = Math.floor(count / 2);
  return Array.from({ length: count }, (_, i) => {
    if (i < mid) return makeCandle(i + 1, 50_000 + i * 200, 50_200 + i * 200);
    return makeCandle(i + 1, 60_000 - (i - mid) * 200, 59_800 - (i - mid) * 200);
  });
}

// ─── Mock strategy factory ────────────────────────────────────────────────────

/**
 * Builds a mock strategy that:
 *   - Emits BUY on the first active bar, SELL on bar `exitAtBar`
 *   - Ignores indicator values; just counts bars
 */
function buildMockStrategy(exitAtBar = 5): IStrategy {
  let barIndex = 0;

  const fakeConfig: StrategyPluginConfig = {
    strategyId: STRATEGY_ID,
    name: 'WF Test Strategy',
    version: '1.0.0',
    parameters: {},
    riskProfile: {
      maxPositionSizePercent: 10,
      maxDrawdownPercent: 30,
      stopLossPercent: 5,
      takeProfitPercent: 15,
      maxOpenOrders: 1,
    },
    enabledSymbols: ['BTC/USDT'],
    enabledSessions: [],
    resourceLimits: {},
  };

  const makeSignal = (direction: SignalDirection, ctx: StrategyContext): Signal => ({
    signalId: `sig-${Date.now()}-${Math.random()}`,
    timestamp: ctx.timestamp,
    strategyId: STRATEGY_ID,
    exchange: ctx.exchange,
    symbol: ctx.symbol,
    direction,
    confidence: 0.9,
    reason: direction,
    metadata: {},
  });

  const metrics: StrategyMetrics = {
    signalsGenerated: 0,
    averageRuntimeMs: 0,
    errorsCount: 0,
    skippedEvents: 0,
    warmupProgress: 100,
  };

  return {
    id: STRATEGY_ID,
    config: fakeConfig,
    state: StrategyState.RUNNING,
    version: '1.0.0',
    initialize: jest.fn().mockResolvedValue(undefined),
    loadConfiguration: jest.fn().mockResolvedValue(undefined),
    validateConfiguration: jest.fn().mockReturnValue(ok(undefined as any)),
    warmup: jest.fn().mockResolvedValue(undefined),
    onTick: jest.fn().mockResolvedValue(undefined),
    onTrade: jest.fn().mockResolvedValue(undefined),
    onCandle: jest.fn(async () => {
      barIndex++;
    }),
    generateSignal: jest.fn(async (ctx: StrategyContext): Promise<Signal | null> => {
      if (barIndex === 1) return makeSignal(SignalDirection.BUY, ctx);
      if (barIndex === exitAtBar) return makeSignal(SignalDirection.SELL, ctx);
      return makeSignal(SignalDirection.HOLD, ctx);
    }),
    onOrderFilled: jest.fn().mockResolvedValue(undefined),
    onOrderRejected: jest.fn().mockResolvedValue(undefined),
    onPositionOpened: jest.fn().mockResolvedValue(undefined),
    onPositionClosed: jest.fn().mockResolvedValue(undefined),
    setEnabled: jest.fn(),
    shutdown: jest.fn().mockResolvedValue(undefined),
    getHealth: jest.fn().mockReturnValue({
      id: STRATEGY_ID,
      name: 'WF Test Strategy',
      version: '1.0.0',
      state: StrategyState.RUNNING,
      enabled: true,
      metrics,
      lastSignalAt: null,
      lastErrorAt: null,
      lastError: null,
    } as StrategyHealth),
    getMetrics: jest.fn().mockReturnValue(metrics),
  };
}

// ─── Engine factory ───────────────────────────────────────────────────────────

function buildWalkForwardEngine(allCandles: Candle[]) {
  const queue = new OrderQueueService();
  const executionSimulator = new ExecutionSimulatorService(queue);
  const portfolioTracker = new BacktestPortfolioTrackerService();
  const equityCurve = new EquityCurveBuilderService();
  const reportGenerator = new ReportGeneratorService(
    new PerformanceCalculatorService(),
    new DrawdownCalculatorService(),
    new RiskMetricsCalculatorService(),
  );
  const riskEvaluator = new BacktestRiskEvaluator();
  const replayEngine = new ReplayEngineService(mockLogger);

  const mockLoader = {
    load: jest.fn().mockResolvedValue(allCandles),
    isAvailable: jest.fn().mockResolvedValue(true),
    sourceType: DataSourceType.CSV,
  };

  const strategyLoader = {
    load: jest.fn().mockImplementation(() => Promise.resolve(buildMockStrategy(5))),
  };

  const backtestEngine = new BacktestEngineService(
    mockLogger,
    { resolve: () => mockLoader } as any,
    replayEngine,
    { createForSymbol: () => [] } as any,
    riskEvaluator,
    executionSimulator,
    portfolioTracker,
    equityCurve,
    reportGenerator,
    strategyLoader as any,
    { unregister: jest.fn() } as any,
  );

  const windowGenerator = new WindowGeneratorService();
  const optimizer = new ParameterOptimizerService(backtestEngine, mockLogger);
  const stabilityAnalyzer = new ParameterStabilityAnalyzerService();
  const reportGen = new WalkForwardReportGeneratorService();
  const engine = new WalkForwardEngineService(
    windowGenerator,
    optimizer,
    backtestEngine,
    stabilityAnalyzer,
    reportGen,
    mockLogger,
  );

  return { engine, strategyLoader, mockLoader };
}

// ─── Base config ──────────────────────────────────────────────────────────────

function makeWfConfig(overrides: Partial<WalkForwardConfig> = {}): WalkForwardConfig {
  return {
    runId: 'integration-test',
    startTime: BAR_MS * 1,
    endTime: BAR_MS * 100,
    baseBacktestConfig: {
      symbol: 'BTC/USDT',
      exchange: 'test',
      timeframe: Timeframe.ONE_HOUR,
      warmupCandles: 0,
      initialCapitalUsd: 100_000,
      commission: { makerBps: 0, takerBps: 0 },
      slippage: { fixedBps: 0, volumeParticipationRate: 0.5, maxSlippageBps: 0 },
      dataSource: DataSourceType.CSV,
      enableRiskChecks: false,
      maxPositionSizePercent: 10,
      maxDailyLossPercent: 5,
      fillOnClose: false,
    },
    strategyType: 'wf-mock',
    baseStrategyConfig: {
      strategyId: STRATEGY_ID,
      name: 'WF Test Strategy',
      version: '1.0.0',
      parameters: {},
      riskProfile: {
        maxPositionSizePercent: 10,
        maxDrawdownPercent: 30,
        stopLossPercent: 5,
        takeProfitPercent: 15,
        maxOpenOrders: 1,
      },
      enabledSymbols: ['BTC/USDT'],
      enabledSessions: [],
      resourceLimits: {},
    },
    windowType: WindowType.ROLLING,
    trainWindowMs: BAR_MS * 30,
    testWindowMs: BAR_MS * 10,
    parameterGrid: { multiplier: [1, 2] },
    optimizationMetric: OptimizationMetric.NET_PROFIT,
    minTradesRequired: 0,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WalkForwardEngineService — integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('basic correctness', () => {
    it('produces one WalkForwardResult with all required fields', async () => {
      const candles = makeUptrendCandles(100);
      const { engine } = buildWalkForwardEngine(candles);
      const result = await engine.run(makeWfConfig());

      expect(result.runId).toBe('integration-test');
      expect(result.windows).toBeDefined();
      expect(result.parameterStability).toBeDefined();
      expect(typeof result.isRobust).toBe('boolean');
      expect(result.robustnessReason).toBeTruthy();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('generates the correct number of windows', async () => {
      // startTime=1h, endTime=100h, train=30h, test=10h, step=10h → 6 windows
      const candles = makeUptrendCandles(100);
      const { engine } = buildWalkForwardEngine(candles);
      const result = await engine.run(makeWfConfig());

      expect(result.totalWindowsRun).toBe(6);
      expect(result.windows).toHaveLength(6);
    });

    it('each window has both train and test results', async () => {
      const candles = makeUptrendCandles(100);
      const { engine } = buildWalkForwardEngine(candles);
      const result = await engine.run(makeWfConfig());

      for (const w of result.windows) {
        expect(w.trainResult).toBeDefined();
        expect(w.testResult).toBeDefined();
        expect(w.bestParams).toBeDefined();
        expect(typeof w.performanceDecayRatio).toBe('number');
      }
    });

    it('trainEnd equals testStart for every window', async () => {
      const candles = makeUptrendCandles(100);
      const { engine } = buildWalkForwardEngine(candles);
      const result = await engine.run(makeWfConfig());

      for (const w of result.windows) {
        expect(w.window.trainEndTime).toBe(w.window.testStartTime);
      }
    });

    it('tracks total optimization runs correctly', async () => {
      // 6 windows × 2 combinations (multiplier: [1,2]) = 12 optimization runs
      const candles = makeUptrendCandles(100);
      const { engine } = buildWalkForwardEngine(candles);
      const result = await engine.run(makeWfConfig());

      expect(result.totalOptimizationRuns).toBe(12);
    });

    it('params in each window come from the grid', async () => {
      const candles = makeUptrendCandles(100);
      const { engine } = buildWalkForwardEngine(candles);
      const config = makeWfConfig({ parameterGrid: { multiplier: [1, 2] } });
      const result = await engine.run(config);

      for (const w of result.windows) {
        expect([1, 2]).toContain(w.bestParams['multiplier']);
      }
    });
  });

  describe('parameter stability', () => {
    it('stability report contains all grid parameters', async () => {
      const candles = makeUptrendCandles(100);
      const { engine } = buildWalkForwardEngine(candles);
      const config = makeWfConfig({ parameterGrid: { multiplier: [1, 2], period: [10, 20] } });
      const result = await engine.run(config);

      expect(result.parameterStability.parameters).toHaveProperty('multiplier');
      expect(result.parameterStability.parameters).toHaveProperty('period');
    });

    it('stability score is between 0 and 1', async () => {
      const candles = makeUptrendCandles(100);
      const { engine } = buildWalkForwardEngine(candles);
      const result = await engine.run(makeWfConfig());

      expect(result.parameterStability.overallStabilityScore).toBeGreaterThanOrEqual(0);
      expect(result.parameterStability.overallStabilityScore).toBeLessThanOrEqual(1);
    });
  });

  describe('aggregate OOS metrics', () => {
    it('totalOosTrades is sum of trades across all test windows', async () => {
      const candles = makeUptrendCandles(100);
      const { engine } = buildWalkForwardEngine(candles);
      const result = await engine.run(makeWfConfig());

      const expectedTotal = result.windows.reduce(
        (sum, w) => sum + (w.testResult.report?.totalTrades ?? 0),
        0,
      );
      expect(result.totalOosTrades).toBe(expectedTotal);
    });

    it('combinedOosMaxDrawdown equals the worst drawdown across test windows', async () => {
      const candles = makeUptrendCandles(100);
      const { engine } = buildWalkForwardEngine(candles);
      const result = await engine.run(makeWfConfig());

      const expectedMax = Math.max(
        ...result.windows.map((w) => w.testResult.report?.maxDrawdownPercent ?? 0),
      );
      expect(result.combinedOosMaxDrawdown).toBeCloseTo(expectedMax);
    });
  });

  describe('stable strategy on uptrend data', () => {
    it('uptrending market → positive combined OOS net profit', async () => {
      const candles = makeUptrendCandles(100);
      const { engine } = buildWalkForwardEngine(candles);
      const result = await engine.run(makeWfConfig());

      expect(result.combinedOosNetProfit).toBeGreaterThan(0);
    });

    it('performance decay ratio is computed', async () => {
      const candles = makeUptrendCandles(100);
      const { engine } = buildWalkForwardEngine(candles);
      const result = await engine.run(makeWfConfig());

      expect(typeof result.performanceDecayRatio).toBe('number');
    });
  });

  describe('window skipping when minTradesRequired filters all', () => {
    it('skips windows when no combination produces enough trades', async () => {
      const candles = makeUptrendCandles(100);
      const { engine } = buildWalkForwardEngine(candles);
      // Require 999 trades — impossible with mock strategy
      const result = await engine.run(makeWfConfig({ minTradesRequired: 999 }));

      expect(result.totalWindowsRun).toBe(0);
      expect(result.windows).toHaveLength(0);
    });
  });

  describe('anchored walk-forward', () => {
    it('runs successfully with ANCHORED window type', async () => {
      const candles = makeUptrendCandles(100);
      const { engine } = buildWalkForwardEngine(candles);
      const result = await engine.run(makeWfConfig({ windowType: WindowType.ANCHORED }));

      expect(result.totalWindowsRun).toBe(6);
      result.windows.forEach((w) => expect(w.window.trainStartTime).toBe(BAR_MS * 1));
    });
  });

  describe('overfit detection scenario', () => {
    it('mixed market (uptrend→downtrend) produces decay ratio < 1 for buy-hold strategy', async () => {
      // First 50 bars uptrend, last 50 downtrend.
      // Strategy always buys early in each window → profits in uptrend windows,
      // losses in downtrend windows → OOS underperforms training.
      const candles = makeMixedCandles(100);
      const { engine } = buildWalkForwardEngine(candles);
      const result = await engine.run(
        makeWfConfig({ optimizationMetric: OptimizationMetric.NET_PROFIT }),
      );

      // Some windows should show positive training but negative OOS
      const hasDecay = result.windows.some((w) => w.performanceDecayRatio < 1);
      expect(hasDecay).toBe(true);
    });
  });

  describe('multiple assets (separate runs)', () => {
    it('runs independently on BTC and ETH candles', async () => {
      const btcCandles = makeUptrendCandles(100);
      const ethCandles = makeUptrendCandles(100).map((c) => ({
        ...c,
        symbol: 'ETH/USDT',
        open: c.open / 20,
        close: c.close / 20,
        high: c.high / 20,
        low: c.low / 20,
      }));

      const { engine: btcEngine } = buildWalkForwardEngine(btcCandles);
      const { engine: ethEngine } = buildWalkForwardEngine(ethCandles);

      const btcConfig = makeWfConfig({ runId: 'btc-run' });
      const ethConfig = makeWfConfig({
        runId: 'eth-run',
        baseBacktestConfig: { ...makeWfConfig().baseBacktestConfig, symbol: 'ETH/USDT' },
      });

      const [btcResult, ethResult] = await Promise.all([
        btcEngine.run(btcConfig),
        ethEngine.run(ethConfig),
      ]);

      expect(btcResult.runId).toBe('btc-run');
      expect(ethResult.runId).toBe('eth-run');
      expect(btcResult.totalWindowsRun).toBe(6);
      expect(ethResult.totalWindowsRun).toBe(6);
    });
  });

  describe('random strategy (no param grid)', () => {
    it('runs with empty param grid (single combination)', async () => {
      const candles = makeUptrendCandles(100);
      const { engine } = buildWalkForwardEngine(candles);
      const result = await engine.run(makeWfConfig({ parameterGrid: {} }));

      expect(result.totalOptimizationRuns).toBe(6); // 6 windows × 1 combo
      expect(result.windows).toHaveLength(6);
    });
  });
});
