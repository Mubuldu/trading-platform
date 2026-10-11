import { BacktestEngineService } from '@modules/backtest/application/engine/backtest-engine.service';
import { ReplayEngineService } from '@modules/backtest/application/replay/replay-engine.service';
import { ExecutionSimulatorService } from '@modules/backtest/application/execution-simulator/execution-simulator.service';
import { OrderQueueService } from '@modules/backtest/application/execution-simulator/order-queue.service';
import { BacktestPortfolioTrackerService } from '@modules/backtest/application/portfolio/backtest-portfolio-tracker.service';
import { EquityCurveBuilderService } from '@modules/backtest/application/portfolio/equity-curve-builder.service';
import { PerformanceCalculatorService } from '@modules/backtest/application/reports/statistics/performance-calculator.service';
import { DrawdownCalculatorService } from '@modules/backtest/application/reports/statistics/drawdown-calculator.service';
import { RiskMetricsCalculatorService } from '@modules/backtest/application/reports/statistics/risk-metrics-calculator.service';
import { ReportGeneratorService } from '@modules/backtest/application/reports/report-generator.service';
import { BacktestRiskEvaluator } from '@modules/backtest/application/engine/backtest-risk-evaluator';
import { BacktestConfig } from '@modules/backtest/domain/models/backtest-config.model';
import { BacktestState } from '@modules/backtest/domain/enums/backtest-state.enum';
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

const mockLogger = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
} as any;

const BAR_MS = 3_600_000;

const makeCandle = (openTime: number, open: number, close: number): Candle => ({
  symbol: 'BTC/USDT',
  exchange: 'test',
  timeframe: Timeframe.ONE_HOUR,
  openTime,
  closeTime: openTime + BAR_MS - 1,
  open,
  high: Math.max(open, close) + 100,
  low: Math.min(open, close) - 100,
  close,
  volume: 500,
  isClosed: true,
});

const CANDLES: Candle[] = [
  makeCandle(BAR_MS * 1, 50_000, 50_500),
  makeCandle(BAR_MS * 2, 50_500, 51_000),
  makeCandle(BAR_MS * 3, 51_000, 51_500),
  makeCandle(BAR_MS * 4, 51_500, 52_000),
  makeCandle(BAR_MS * 5, 52_000, 52_500),
  makeCandle(BAR_MS * 6, 52_500, 53_000),
];

const START_TIME = BAR_MS * 1;
const END_TIME = BAR_MS * 6;
const STRATEGY_ID = 'backtest-integration-strat';

function buildMockStrategy(): IStrategy {
  let barIndex = 0;

  const fakeConfig: StrategyPluginConfig = {
    strategyId: STRATEGY_ID,
    name: 'Integration Test Strategy',
    version: '1.0.0',
    parameters: {},
    riskProfile: {
      maxPositionSizePercent: 10,
      maxDrawdownPercent: 20,
      stopLossPercent: 5,
      takeProfitPercent: 10,
      maxOpenOrders: 5,
    },
    enabledSymbols: ['BTC/USDT'],
    enabledSessions: [],
    resourceLimits: {},
  };

  const makeSignal = (direction: SignalDirection, ctx: StrategyContext): Signal => ({
    signalId: `sig-${Date.now()}`,
    timestamp: ctx.timestamp,
    strategyId: STRATEGY_ID,
    exchange: ctx.exchange,
    symbol: ctx.symbol,
    direction,
    confidence: 0.8,
    reason: direction,
    metadata: {},
  });

  const mockMetrics: StrategyMetrics = {
    signalsGenerated: 0,
    averageRuntimeMs: 0,
    errorsCount: 0,
    skippedEvents: 0,
    warmupProgress: 100,
  };

  const mockHealth: StrategyHealth = {
    id: STRATEGY_ID,
    name: 'Integration Test Strategy',
    version: '1.0.0',
    state: StrategyState.RUNNING,
    enabled: true,
    metrics: mockMetrics,
    lastSignalAt: null,
    lastErrorAt: null,
    lastError: null,
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

    generateSignal: jest.fn(async (ctx: StrategyContext) => {
      // bar0 (index=1) → BUY, bar3 (index=4) → SELL, else HOLD
      if (barIndex === 1) return makeSignal(SignalDirection.BUY, ctx);
      if (barIndex === 4) return makeSignal(SignalDirection.SELL, ctx);
      return makeSignal(SignalDirection.HOLD, ctx);
    }),

    onOrderFilled: jest.fn().mockResolvedValue(undefined),
    onOrderRejected: jest.fn().mockResolvedValue(undefined),
    onPositionOpened: jest.fn().mockResolvedValue(undefined),
    onPositionClosed: jest.fn().mockResolvedValue(undefined),

    setEnabled: jest.fn(),
    shutdown: jest.fn().mockResolvedValue(undefined),

    getHealth: jest.fn().mockReturnValue(mockHealth),
    getMetrics: jest.fn().mockReturnValue(mockMetrics),
  };
}

function buildEngine(mockStrategy: IStrategy) {
  const queue = new OrderQueueService();
  const executionSimulator = new ExecutionSimulatorService(queue);
  const portfolioTracker = new BacktestPortfolioTrackerService();
  const equityCurve = new EquityCurveBuilderService();
  const performanceCalc = new PerformanceCalculatorService();
  const drawdownCalc = new DrawdownCalculatorService();
  const riskMetricsCalc = new RiskMetricsCalculatorService();
  const reportGenerator = new ReportGeneratorService(
    performanceCalc,
    drawdownCalc,
    riskMetricsCalc,
  );
  const riskEvaluator = new BacktestRiskEvaluator();
  const replayEngine = new ReplayEngineService(mockLogger);

  const mockLoader = {
    load: jest.fn().mockResolvedValue(CANDLES),
    isAvailable: jest.fn().mockResolvedValue(true),
    sourceType: DataSourceType.CSV,
  };

  const engine = new BacktestEngineService(
    mockLogger,
    { resolve: () => mockLoader } as any,
    replayEngine,
    { createForSymbol: () => [] } as any,
    riskEvaluator,
    executionSimulator,
    portfolioTracker,
    equityCurve,
    reportGenerator,
    { load: jest.fn().mockResolvedValue(mockStrategy) } as any,
    { unregister: jest.fn() } as any,
  );

  return { engine };
}

const baseConfig: BacktestConfig = {
  sessionId: 'integration-test-session',
  symbol: 'BTC/USDT',
  exchange: 'test',
  timeframe: Timeframe.ONE_HOUR,
  startTime: START_TIME,
  endTime: END_TIME,
  warmupCandles: 0,
  initialCapitalUsd: 100_000,
  commission: { makerBps: 0, takerBps: 0 },
  slippage: { fixedBps: 0, volumeParticipationRate: 0.5, maxSlippageBps: 0 },
  dataSource: DataSourceType.CSV,
  strategies: [{ strategyType: 'MockStrategy', config: { strategyId: STRATEGY_ID } as any }],
  enableRiskChecks: false,
  maxPositionSizePercent: 10,
  maxDailyLossPercent: 5,
  fillOnClose: false,
};

describe('BacktestEngineService — integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('runs to completion and returns COMPLETED state', async () => {
    const { engine } = buildEngine(buildMockStrategy());
    const result = await engine.run(baseConfig);

    expect(result.state).toBe(BacktestState.COMPLETED);
    expect(result.sessionId).toBe(baseConfig.sessionId);
    expect(result.errorMessage).toBeUndefined();
  });

  it('records one round-trip trade with correct profit', async () => {
    const { engine } = buildEngine(buildMockStrategy());
    const result = await engine.run(baseConfig);

    expect(result.report).toBeDefined();
    expect(result.report!.totalTrades).toBe(1);
    expect(result.report!.winningTrades).toBe(1);
    expect(result.report!.losingTrades).toBe(0);
    expect(result.report!.winRate).toBe(1);
    expect(result.report!.totalReturn).toBeGreaterThan(0);
  });

  it('produces positive PnL with zero commission and zero slippage', async () => {
    const { engine } = buildEngine(buildMockStrategy());
    const result = await engine.run(baseConfig);

    expect(result.report!.finalEquity).toBeGreaterThan(baseConfig.initialCapitalUsd);
    expect(result.report!.totalCommission).toBe(0);
    expect(result.report!.totalSlippage).toBe(0);
  });

  it('generates equity curve with one entry per active bar', async () => {
    const { engine } = buildEngine(buildMockStrategy());
    const result = await engine.run(baseConfig);

    expect(result.report!.equityCurve.length).toBe(CANDLES.length);
  });

  it('is deterministic — same config produces identical results on two runs', async () => {
    const [m1, m2] = [buildMockStrategy(), buildMockStrategy()];
    const { engine: e1 } = buildEngine(m1);
    const { engine: e2 } = buildEngine(m2);

    const [r1, r2] = await Promise.all([e1.run(baseConfig), e2.run(baseConfig)]);

    expect(r1.report!.totalReturn).toBe(r2.report!.totalReturn);
    expect(r1.report!.totalTrades).toBe(r2.report!.totalTrades);
    expect(r1.report!.finalEquity).toBe(r2.report!.finalEquity);
  });

  it('returns FAILED state when strategy load throws', async () => {
    const queue = new OrderQueueService();
    const executionSimulator = new ExecutionSimulatorService(queue);
    const portfolioTracker = new BacktestPortfolioTrackerService();
    const equityCurve = new EquityCurveBuilderService();
    const reportGenerator = new ReportGeneratorService(
      new PerformanceCalculatorService(),
      new DrawdownCalculatorService(),
      new RiskMetricsCalculatorService(),
    );

    const engine = new BacktestEngineService(
      mockLogger,
      {
        resolve: () => ({
          load: jest.fn().mockResolvedValue(CANDLES),
          isAvailable: jest.fn().mockResolvedValue(true),
        }),
      } as any,
      new ReplayEngineService(mockLogger),
      { createForSymbol: () => [] } as any,
      new BacktestRiskEvaluator(),
      executionSimulator,
      portfolioTracker,
      equityCurve,
      reportGenerator,
      { load: jest.fn().mockRejectedValue(new Error('Strategy not found')) } as any,
      { unregister: jest.fn() } as any,
    );

    const result = await engine.run(baseConfig);

    expect(result.state).toBe(BacktestState.FAILED);
    expect(result.errorMessage).toBeDefined();
    expect(result.report).toBeUndefined();
  });

  it('calls strategy shutdown after run completes', async () => {
    const mockStrategy = buildMockStrategy();
    const { engine } = buildEngine(mockStrategy);

    await engine.run(baseConfig);

    expect(mockStrategy.shutdown).toHaveBeenCalledTimes(1);
  });
});
