import { StrategyRegistryService } from '../../../src/modules/strategy/registry/strategy-registry.service';
import { StrategySchedulerService } from '../../../src/modules/strategy/scheduler/strategy-scheduler.service';
import { BaseStrategy } from '../../../src/modules/strategy/framework/base-strategy';
import {
  StrategyPluginConfig,
  StrategyContext,
} from '../../../src/modules/strategy/interfaces/strategy.interface';
import { Signal } from '../../../src/modules/strategy/interfaces/signal.interface';
import { StrategyState } from '../../../src/modules/strategy/domain/enums/strategy-state.enum';
import { AppLoggerService } from '../../../src/core/logging/app-logger.service';
import { Candle } from '../../../src/modules/indicator/domain/models/candle.model';
import { Timeframe } from '../../../src/modules/indicator/domain/enums/timeframe.enum';

function makeConfig(id: string): StrategyPluginConfig {
  return {
    strategyId: id,
    name: `Strategy ${id}`,
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
    resourceLimits: { maxRuntimeMs: 2000, maxEventsPerSecond: 1000 },
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

class GoodStrategy extends BaseStrategy {
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

class CrashOnCandleStrategy extends BaseStrategy {
  crashCount = 0;
  constructor(config: StrategyPluginConfig) {
    super(config);
  }
  protected override async doOnCandle(_candle: Candle): Promise<void> {
    this.crashCount++;
    throw new Error('simulated crash in onCandle');
  }
  protected override async doGenerateSignal(_ctx: StrategyContext): Promise<Signal | null> {
    return null;
  }
}

class CrashOnSignalStrategy extends BaseStrategy {
  constructor(config: StrategyPluginConfig) {
    super(config);
  }
  protected override async doGenerateSignal(_ctx: StrategyContext): Promise<Signal | null> {
    throw new Error('simulated crash in generateSignal');
  }
}

describe('Strategy Isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('one crashing strategy does not prevent others from receiving candle events', async () => {
    const { registry, scheduler } = makeScheduler();

    const good1 = new GoodStrategy(makeConfig('good-1'));
    const crasher = new CrashOnCandleStrategy(makeConfig('crasher-1'));
    const good2 = new GoodStrategy(makeConfig('good-2'));

    registry.register(good1);
    registry.register(crasher);
    registry.register(good2);
    registry.enable('good-1');
    registry.enable('crasher-1');
    registry.enable('good-2');

    await scheduler.dispatchCandle(makeCandle());

    expect(good1.callCount).toBe(1);
    expect(crasher.crashCount).toBe(1);
    expect(good2.callCount).toBe(1);
  });

  it('crashing strategy transitions to ERROR state, others remain unaffected', async () => {
    const { registry, scheduler } = makeScheduler();

    const good = new GoodStrategy(makeConfig('good-x'));
    const crasher = new CrashOnCandleStrategy(makeConfig('crash-x'));

    registry.register(good);
    registry.register(crasher);
    registry.enable('good-x');
    registry.enable('crash-x');

    await scheduler.dispatchCandle(makeCandle());

    expect(crasher.state).toBe(StrategyState.ERROR);
    expect(good.state).not.toBe(StrategyState.ERROR);
  });

  it('subsequent dispatches still reach healthy strategies after one crashes', async () => {
    const { registry, scheduler } = makeScheduler();

    const good = new GoodStrategy(makeConfig('persistent'));
    const crasher = new CrashOnCandleStrategy(makeConfig('one-shot-crash'));

    registry.register(good);
    registry.register(crasher);
    registry.enable('persistent');
    registry.enable('one-shot-crash');

    await scheduler.dispatchCandle(makeCandle());
    await scheduler.dispatchCandle(makeCandle());

    expect(good.callCount).toBe(2);
  });

  it('strategy crashing in generateSignal does not prevent signal collection from others', async () => {
    const { registry, scheduler } = makeScheduler();

    const crasher = new CrashOnSignalStrategy(makeConfig('signal-crasher'));
    const good = new GoodStrategy(makeConfig('signal-good'));

    registry.register(crasher);
    registry.register(good);
    registry.enable('signal-crasher');
    registry.enable('signal-good');

    const ctx: StrategyContext = {
      exchange: 'binance',
      symbol: 'BTC/USDT',
      timestamp: Date.now(),
      indicators: new Map(),
    };

    const signals = await scheduler.dispatchSignalGeneration(ctx);
    // Crash is caught by BaseStrategy — no signals emitted, error recorded internally
    expect(signals).toHaveLength(0);
    expect(crasher.state).toBe(StrategyState.ERROR);
    expect(good.state).not.toBe(StrategyState.ERROR);
    expect(crasher.getMetrics().errorsCount).toBe(1);
  });

  it('disabled strategies do not receive events', async () => {
    const { registry, scheduler } = makeScheduler();

    const active = new GoodStrategy(makeConfig('active'));
    const inactive = new GoodStrategy(makeConfig('inactive'));

    registry.register(active);
    registry.register(inactive);
    registry.enable('active');

    await scheduler.dispatchCandle(makeCandle());

    expect(active.callCount).toBe(1);
    expect(inactive.callCount).toBe(0);
  });
});
