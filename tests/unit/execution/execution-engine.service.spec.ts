import { ExecutionEngineService } from '../../../src/modules/execution/application/services/execution-engine.service';
import { ExecutionValidatorService } from '../../../src/modules/execution/application/services/execution-validator.service';
import { OrderTrackerService } from '../../../src/modules/execution/application/services/order-tracker.service';
import { FillProcessorService } from '../../../src/modules/execution/application/services/fill-processor.service';
import { LatencyMonitorService } from '../../../src/modules/execution/application/services/latency-monitor.service';
import { RiskDecisionModel } from '../../../src/modules/risk/domain/models/risk-decision.model';
import { RiskDecision } from '../../../src/modules/risk/domain/enums/risk-decision.enum';
import { SignalDirection } from '../../../src/modules/strategy/domain/enums/signal-direction.enum';
import { ExecutionConfig } from '../../../src/config/execution.config';
import { ExchangeId } from '../../../src/modules/exchange/enums/exchange.enums';
import {
  OrderSide,
  OrderType,
  OrderStatus,
  TimeInForce,
} from '../../../src/modules/exchange/enums/order.enums';
import { ExecutionStatus } from '../../../src/modules/execution/domain/enums/execution-status.enum';
import { ExecutionReportType } from '../../../src/modules/execution/domain/enums/execution-report-type.enum';

function makeConfig(overrides: Partial<ExecutionConfig> = {}): ExecutionConfig {
  return {
    enabled: true,
    orderRoutingMode: 'direct',
    slippageToleranceBps: 10,
    maxSlippageBps: 50,
    retryOnPartialFill: false,
    maxRetries: 3,
    orderTimeoutMs: 30_000,
    cancelOnTimeout: true,
    ...overrides,
  };
}

function makeConfigService(cfg: ExecutionConfig): any {
  return { get: (_key: string) => cfg };
}

function makeLogger(): any {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

function makeEventBus(): any {
  return {
    publish: jest.fn().mockResolvedValue({ isOk: () => true, isErr: () => false }),
    subscribe: jest.fn(),
  };
}

function makePublisher(): any {
  return { publish: jest.fn().mockResolvedValue('stream-id-1') };
}

function makeDecision(overrides: Partial<RiskDecisionModel> = {}): RiskDecisionModel {
  return {
    decisionId: 'd-1',
    signal: {
      signalId: 'sig-1',
      timestamp: Date.now(),
      strategyId: 'strat-1',
      exchange: 'paper_trading',
      symbol: 'BTC/USDT',
      direction: SignalDirection.BUY,
      confidence: 0.8,
      reason: 'test',
      metadata: {},
    },
    decision: RiskDecision.APPROVE,
    violations: [],
    recommendedSize: null,
    recommendedSizeUsd: 1000,
    sizingMethod: null,
    sizeReductionFactor: 1.0,
    reason: 'all good',
    evaluatedAt: Date.now(),
    durationMs: 5,
    ...overrides,
  };
}

function makeOrder(status: OrderStatus = OrderStatus.FILLED) {
  return {
    exchangeOrderId: 'ex-1',
    clientOrderId: 'cl-1',
    side: OrderSide.BUY,
    type: OrderType.MARKET,
    status,
    originalQuantity: 0.1,
    executedQuantity: status === OrderStatus.FILLED ? 0.1 : 0,
    remainingQuantity: status === OrderStatus.FILLED ? 0 : 0.1,
    cumulativeQuoteQuantity: 5000,
    price: 50_000,
    averagePrice: 50_000,
    timeInForce: TimeInForce.GTC,
    symbol: 'BTC/USDT',
    exchangeId: ExchangeId.PAPER_TRADING,
    timestamp: new Date(),
    updatedAt: new Date(),
  };
}

function makeRequest() {
  return {
    requestId: 'req-1',
    decisionId: 'd-1',
    strategyId: 'strat-1',
    signalId: 'sig-1',
    exchangeId: ExchangeId.PAPER_TRADING,
    symbol: 'BTC/USDT',
    side: OrderSide.BUY,
    orderType: OrderType.MARKET,
    quantity: 0.02,
    clientOrderId: 'strat-1-d-1-1234',
    correlationId: 'corr-1',
    createdAt: Date.now(),
  };
}

function buildEngine(cfgOverrides: Partial<ExecutionConfig> = {}) {
  const cfg = makeConfig(cfgOverrides);
  const configService = makeConfigService(cfg);
  const logger = makeLogger();
  const eventBus = makeEventBus();
  const publisher = makePublisher();
  const validator = new ExecutionValidatorService();
  const router = {
    route: jest
      .fn()
      .mockReturnValue({ isOk: () => true, isErr: () => false, value: makeAdapter() }),
  };
  const builder = {
    build: jest
      .fn()
      .mockResolvedValue({ isOk: () => true, isErr: () => false, value: makeRequest() }),
  };
  const retryManager = {
    submit: jest.fn().mockResolvedValue({
      isOk: () => true,
      isErr: () => false,
      value: { order: makeOrder(), attempts: 1 },
    }),
  };
  const tracker = new OrderTrackerService();
  const fillProcessor = new FillProcessorService();
  const latencyMonitor = new LatencyMonitorService();

  const engine = new ExecutionEngineService(
    configService,
    logger,
    eventBus,
    publisher,
    validator,
    router as any,
    builder as any,
    retryManager as any,
    tracker,
    fillProcessor,
    latencyMonitor,
  );

  return { engine, eventBus, publisher, router, builder, retryManager, tracker, logger };
}

function makeAdapter() {
  return {
    getExchangeId: jest.fn().mockReturnValue(ExchangeId.PAPER_TRADING),
    isConnected: jest.fn().mockReturnValue(true),
    getCapabilities: jest.fn().mockReturnValue({ supportsTrailingStop: false }),
  };
}

describe('ExecutionEngineService', () => {
  describe('onModuleInit', () => {
    it('subscribes to RiskDecision events when enabled', () => {
      const { engine, eventBus } = buildEngine();
      engine.onModuleInit();
      expect(eventBus.subscribe).toHaveBeenCalledWith('RiskDecision', expect.any(Function));
    });

    it('does not subscribe when disabled', () => {
      const { engine, eventBus } = buildEngine({ enabled: false });
      engine.onModuleInit();
      expect(eventBus.subscribe).not.toHaveBeenCalled();
    });
  });

  describe('execute — success path', () => {
    it('publishes execution report, audit, and order update on success', async () => {
      const { engine, publisher } = buildEngine();
      await engine.execute(makeDecision());

      expect(publisher.publish).toHaveBeenCalledTimes(3);
      const calls = publisher.publish.mock.calls.map((c: any[]) => c[0]);
      expect(calls).toContain('execution:report');
      expect(calls).toContain('execution:audit');
      expect(calls).toContain('order:update');
    });

    it('tracks order through full lifecycle', async () => {
      const { engine, tracker } = buildEngine();
      await engine.execute(makeDecision());

      const states = tracker.getAll();
      expect(states).toHaveLength(1);
      expect(states[0].status).toBe(ExecutionStatus.FILLED);
    });

    it('logs success at INFO level', async () => {
      const { engine, logger } = buildEngine();
      await engine.execute(makeDecision());
      expect(logger.log).toHaveBeenCalledWith(
        expect.stringContaining('ORDER_FILLED'),
        expect.any(String),
      );
    });
  });

  describe('execute — validation failures', () => {
    it('skips execution silently for HOLD signals', async () => {
      const { engine, publisher } = buildEngine();
      const decision = makeDecision({
        signal: { ...makeDecision().signal, direction: SignalDirection.HOLD },
      });
      await engine.execute(decision);
      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it('skips execution silently for REJECT decisions', async () => {
      const { engine, publisher } = buildEngine();
      const decision = makeDecision({ decision: RiskDecision.REJECT });
      await engine.execute(decision);
      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it('skips execution for zero recommendedSizeUsd', async () => {
      const { engine, publisher } = buildEngine();
      await engine.execute(makeDecision({ recommendedSizeUsd: 0 }));
      expect(publisher.publish).not.toHaveBeenCalled();
    });
  });

  describe('execute — routing failure', () => {
    it('publishes failure report when routing fails', async () => {
      const { engine, publisher } = buildEngine();
      const router = (engine as any).router;
      router.route.mockReturnValue({
        isOk: () => false,
        isErr: () => true,
        error: { message: 'No adapter registered' },
      });

      await engine.execute(makeDecision());
      expect(publisher.publish).toHaveBeenCalledTimes(2); // report + audit only (no order update)
    });
  });

  describe('execute — build failure', () => {
    it('publishes failure report when order build fails', async () => {
      const { engine, publisher } = buildEngine();
      const builder = (engine as any).builder;
      builder.build.mockResolvedValue({
        isOk: () => false,
        isErr: () => true,
        error: { message: 'ticker unavailable' },
      });

      await engine.execute(makeDecision());
      expect(publisher.publish).toHaveBeenCalledTimes(2);
    });
  });

  describe('execute — submission failure', () => {
    it('publishes failure report and marks tracker FAILED when all retries exhausted', async () => {
      const { engine, publisher, tracker } = buildEngine();
      const retryManager = (engine as any).retryManager;
      retryManager.submit.mockResolvedValue({
        isOk: () => false,
        isErr: () => true,
        error: { message: 'max retries exceeded' },
      });

      await engine.execute(makeDecision());
      expect(publisher.publish).toHaveBeenCalledTimes(2);

      const states = tracker.getAll();
      expect(states[0].status).toBe(ExecutionStatus.FAILED);
    });
  });

  describe('execute — partial fill', () => {
    it('reports ORDER_PARTIALLY_FILLED report type', async () => {
      const { engine, publisher } = buildEngine();
      const retryManager = (engine as any).retryManager;
      retryManager.submit.mockResolvedValue({
        isOk: () => true,
        isErr: () => false,
        value: { order: makeOrder(OrderStatus.PARTIALLY_FILLED), attempts: 1 },
      });

      await engine.execute(makeDecision());
      const reportCall = publisher.publish.mock.calls.find(
        (c: any[]) => c[0] === 'execution:report',
      );
      const payload = reportCall[1].payload;
      expect(payload.reportType).toBe(ExecutionReportType.ORDER_PARTIALLY_FILLED);
    });
  });

  describe('execute — retry tracking', () => {
    it('records retry count in report when retries occurred', async () => {
      const { engine, publisher } = buildEngine();
      const retryManager = (engine as any).retryManager;
      retryManager.submit.mockResolvedValue({
        isOk: () => true,
        isErr: () => false,
        value: { order: makeOrder(), attempts: 3 },
      });

      await engine.execute(makeDecision());
      const reportCall = publisher.publish.mock.calls.find(
        (c: any[]) => c[0] === 'execution:report',
      );
      expect(reportCall[1].payload.retries).toBe(2);
    });
  });

  describe('execute — publisher errors are swallowed', () => {
    it('does not throw when publisher fails', async () => {
      const { engine, publisher } = buildEngine();
      publisher.publish.mockRejectedValue(new Error('Redis down'));
      await expect(engine.execute(makeDecision())).resolves.not.toThrow();
    });
  });
});
