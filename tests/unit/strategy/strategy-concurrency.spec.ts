import { StrategyRegistryService } from '../../../src/modules/strategy/registry/strategy-registry.service';
import { StrategySchedulerService } from '../../../src/modules/strategy/scheduler/strategy-scheduler.service';
import { BaseStrategy } from '../../../src/modules/strategy/framework/base-strategy';
import {
  StrategyPluginConfig,
  StrategyContext,
} from '../../../src/modules/strategy/interfaces/strategy.interface';
import { Signal } from '../../../src/modules/strategy/interfaces/signal.interface';
import { SignalDirection } from '../../../src/modules/strategy/domain/enums/signal-direction.enum';
import { AppLoggerService } from '../../../src/core/logging/app-logger.service';
import { Candle } from '../../../src/modules/indicator/domain/models/candle.model';
import { Timeframe } from '../../../src/modules/indicator/domain/enums/timeframe.enum';
import { randomUUID } from 'crypto';

function makeConfig(id: string, maxEps = 1000): StrategyPluginConfig {
  return {
    strategyId: id,
    name: `Concurrent Strategy ${id}`,
    version: '1.0.0',
    parameters: {},
    riskProfile: {
      maxPositionSizePercent: 1,
      maxDrawdownPercent: 5,
      stopLossPercent: 2,
      takeProfitPercent: 4,
      maxOpenOrders: 1,
    },
    enabledSymbols: ['BTC/USDT'],
    enabledSessions: [],
    resourceLimits: { maxRuntimeMs: 2000, maxEventsPerSecond: maxEps },
  };
}

const fakeLogger = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
} as unknown as AppLoggerService;

const fakeEventBus = {
  publish: jest
    .fn()
    .mockResolvedValue({ _tag: 'ok', value: undefined, isOk: () => true, isErr: () => false }),
  subscribe: jest.fn(),
} as any;

function makeScheduler() {
  const registry = new StrategyRegistryService();
  const scheduler = new StrategySchedulerService(registry, fakeLogger, fakeEventBus);
  return { registry, scheduler };
}

function makeCandle(): Candle {
  return {
    symbol: 'BTC/USDT',
    exchange: 'binance',
    timeframe: Timeframe.ONE_MINUTE,
    openTime: Date.now() - 60_000,
    closeTime: Date.now(),
    open: 50_000,
    high: 51_000,
    low: 49_000,
    close: 50_500,
    volume: 100,
    isClosed: true,
  };
}

class CountingStrategy extends BaseStrategy {
  callCount = 0;
  constructor(config: StrategyPluginConfig) {
    super(config);
  }
  protected override async doOnCandle(_candle: Candle): Promise<void> {
    this.callCount++;
  }
  protected override async doGenerateSignal(_ctx: StrategyContext): Promise<Signal | null> {
    return null;
  }
}

class SlowStrategy extends BaseStrategy {
  callCount = 0;
  constructor(
    config: StrategyPluginConfig,
    private readonly delayMs: number,
  ) {
    super(config);
  }
  protected override async doOnCandle(_candle: Candle): Promise<void> {
    await new Promise((r) => setTimeout(r, this.delayMs));
    this.callCount++;
  }
  protected override async doGenerateSignal(_ctx: StrategyContext): Promise<Signal | null> {
    return null;
  }
}

class SignalEmittingStrategy extends BaseStrategy {
  constructor(config: StrategyPluginConfig) {
    super(config);
  }
  protected override async doGenerateSignal(context: StrategyContext): Promise<Signal | null> {
    return {
      signalId: randomUUID(),
      timestamp: context.timestamp,
      strategyId: this.id,
      exchange: context.exchange,
      symbol: context.symbol,
      direction: SignalDirection.BUY,
      confidence: 0.9,
      reason: 'test',
      metadata: {},
    };
  }
}

describe('Strategy Concurrency', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('dispatches events to all enabled strategies concurrently', async () => {
    const { registry, scheduler } = makeScheduler();
    const strategies = ['c1', 'c2', 'c3', 'c4', 'c5'].map(
      (id) => new CountingStrategy(makeConfig(id)),
    );
    for (const s of strategies) {
      registry.register(s);
      registry.enable(s.id);
    }

    await scheduler.dispatchCandle(makeCandle());

    for (const s of strategies) {
      expect(s.callCount).toBe(1);
    }
  });

  it('concurrent slow strategies complete without blocking each other', async () => {
    const { registry, scheduler } = makeScheduler();

    const s1 = new SlowStrategy(makeConfig('slow-1'), 50);
    const s2 = new SlowStrategy(makeConfig('slow-2'), 50);
    const s3 = new SlowStrategy(makeConfig('slow-3'), 50);

    registry.register(s1);
    registry.register(s2);
    registry.register(s3);
    registry.enable('slow-1');
    registry.enable('slow-2');
    registry.enable('slow-3');

    const start = Date.now();
    await scheduler.dispatchCandle(makeCandle());
    const elapsed = Date.now() - start;

    expect(s1.callCount).toBe(1);
    expect(s2.callCount).toBe(1);
    expect(s3.callCount).toBe(1);
    // Concurrent execution: should finish in ~50ms, not 150ms
    expect(elapsed).toBeLessThan(500);
  });

  it('collects signals from multiple strategies in a single dispatch', async () => {
    const { registry, scheduler } = makeScheduler();

    const s1 = new SignalEmittingStrategy(makeConfig('sig-1'));
    const s2 = new SignalEmittingStrategy(makeConfig('sig-2'));
    const s3 = new SignalEmittingStrategy(makeConfig('sig-3'));

    registry.register(s1);
    registry.register(s2);
    registry.register(s3);
    registry.enable('sig-1');
    registry.enable('sig-2');
    registry.enable('sig-3');

    const ctx: StrategyContext = {
      exchange: 'binance',
      symbol: 'BTC/USDT',
      timestamp: Date.now(),
      indicators: new Map(),
    };

    const signals = await scheduler.dispatchSignalGeneration(ctx);
    expect(signals).toHaveLength(3);
    const strategyIds = signals.map((s) => s.strategyId);
    expect(strategyIds).toContain('sig-1');
    expect(strategyIds).toContain('sig-2');
    expect(strategyIds).toContain('sig-3');
  });

  it('rate limiting skips events that exceed maxEventsPerSecond', async () => {
    const { registry, scheduler } = makeScheduler();

    const limited = new CountingStrategy(makeConfig('rate-limited', 2));
    registry.register(limited);
    registry.enable('rate-limited');

    // Fire 5 events rapidly — should process at most 2 in the first second
    for (let i = 0; i < 5; i++) {
      await scheduler.dispatchCandle(makeCandle());
    }

    expect(limited.callCount).toBeLessThanOrEqual(2);
    expect(scheduler.getSkippedEvents('rate-limited')).toBeGreaterThanOrEqual(3);
  });

  it('multiple concurrent dispatches do not corrupt per-strategy state', async () => {
    const { registry, scheduler } = makeScheduler();

    const strategies = ['p1', 'p2', 'p3'].map((id) => new CountingStrategy(makeConfig(id)));
    for (const s of strategies) {
      registry.register(s);
      registry.enable(s.id);
    }

    const candles = Array.from({ length: 10 }, () => makeCandle());
    await Promise.all(candles.map((c) => scheduler.dispatchCandle(c)));

    for (const s of strategies) {
      expect(s.callCount).toBe(10);
    }
  });
});
