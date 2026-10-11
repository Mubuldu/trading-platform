import { StrategyRegistryService } from '../../../src/modules/strategy/registry/strategy-registry.service';
import { BaseStrategy } from '../../../src/modules/strategy/framework/base-strategy';
import {
  StrategyPluginConfig,
  StrategyContext,
} from '../../../src/modules/strategy/interfaces/strategy.interface';
import { Signal } from '../../../src/modules/strategy/interfaces/signal.interface';
import { StrategyState } from '../../../src/modules/strategy/domain/enums/strategy-state.enum';

function makeConfig(id = 'test-strategy-1'): StrategyPluginConfig {
  return {
    strategyId: id,
    name: 'Test Strategy',
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
    resourceLimits: { maxRuntimeMs: 1000, maxEventsPerSecond: 10 },
  };
}

class TestStrategy extends BaseStrategy {
  constructor(config: StrategyPluginConfig) {
    super(config);
  }

  protected override async doGenerateSignal(_context: StrategyContext): Promise<Signal | null> {
    return null;
  }
}

function makeStrategy(id = 'test-strategy-1') {
  return new TestStrategy(makeConfig(id));
}

function makeRegistry() {
  return new StrategyRegistryService();
}

describe('StrategyRegistryService', () => {
  describe('register()', () => {
    it('registers a strategy successfully', () => {
      const registry = makeRegistry();
      const result = registry.register(makeStrategy());
      expect(result.isOk()).toBe(true);
      expect(registry.getAll()).toHaveLength(1);
    });

    it('returns error on duplicate registration', () => {
      const registry = makeRegistry();
      const strategy = makeStrategy();
      registry.register(strategy);
      const result = registry.register(strategy);
      expect(result.isErr()).toBe(true);
      expect((result as any).error.message).toContain('already registered');
    });

    it('registers multiple strategies with distinct ids', () => {
      const registry = makeRegistry();
      registry.register(makeStrategy('s1'));
      registry.register(makeStrategy('s2'));
      expect(registry.getAll()).toHaveLength(2);
    });
  });

  describe('unregister()', () => {
    it('removes a registered strategy', () => {
      const registry = makeRegistry();
      const strategy = makeStrategy();
      registry.register(strategy);
      const result = registry.unregister(strategy.id);
      expect(result.isOk()).toBe(true);
      expect(registry.getAll()).toHaveLength(0);
    });

    it('returns error for unknown id', () => {
      const registry = makeRegistry();
      const result = registry.unregister('ghost');
      expect(result.isErr()).toBe(true);
      expect((result as any).error.message).toContain('not found');
    });
  });

  describe('enable() / disable()', () => {
    it('enable() marks strategy as enabled', () => {
      const registry = makeRegistry();
      const strategy = makeStrategy();
      registry.register(strategy);
      registry.enable(strategy.id);
      expect(strategy.getHealth().enabled).toBe(true);
      expect(registry.getEnabled()).toHaveLength(1);
    });

    it('disable() marks strategy as disabled', () => {
      const registry = makeRegistry();
      const strategy = makeStrategy();
      registry.register(strategy);
      registry.enable(strategy.id);
      registry.disable(strategy.id);
      expect(strategy.getHealth().enabled).toBe(false);
      expect(registry.getEnabled()).toHaveLength(0);
    });

    it('enable() returns error for unknown id', () => {
      const registry = makeRegistry();
      const result = registry.enable('ghost');
      expect(result.isErr()).toBe(true);
    });

    it('disable() returns error for unknown id', () => {
      const registry = makeRegistry();
      const result = registry.disable('ghost');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('reload()', () => {
    it('reloads with new config parameters without error', async () => {
      const registry = makeRegistry();
      const strategy = makeStrategy();
      registry.register(strategy);

      const newConfig = { ...makeConfig(), parameters: { period: 20 } };
      const result = await registry.reload(strategy.id, newConfig);
      expect(result.isOk()).toBe(true);
      expect(strategy.config.parameters).toEqual({ period: 20 });
    });

    it('returns error when reloading unknown id', async () => {
      const registry = makeRegistry();
      const result = await registry.reload('ghost', makeConfig());
      expect(result.isErr()).toBe(true);
      expect((result as any).error.message).toContain('not found');
    });

    it('returns error when new config fails validation', async () => {
      class StrictStrategy extends BaseStrategy {
        constructor(config: StrategyPluginConfig) {
          super(config);
        }
        protected override doValidateConfiguration(config: StrategyPluginConfig) {
          const { err } = require('../../../src/common/result');
          const {
            StrategyConfigValidationError,
          } = require('../../../src/modules/strategy/domain/errors/strategy.errors');
          if ((config.parameters as any).invalid) {
            return err(new StrategyConfigValidationError(config.strategyId, 'invalid param'));
          }
          const { ok } = require('../../../src/common/result');
          return ok(undefined);
        }
        protected override async doGenerateSignal(_ctx: StrategyContext): Promise<Signal | null> {
          return null;
        }
      }

      const registry = makeRegistry();
      const strategy = new StrictStrategy(makeConfig('strict-1'));
      registry.register(strategy);

      const badConfig = { ...makeConfig('strict-1'), parameters: { invalid: true } };
      const result = await registry.reload('strict-1', badConfig);
      expect(result.isErr()).toBe(true);
    });
  });

  describe('get()', () => {
    it('returns the strategy for known id', () => {
      const registry = makeRegistry();
      const strategy = makeStrategy();
      registry.register(strategy);
      const result = registry.get(strategy.id);
      expect(result.isOk()).toBe(true);
      expect((result as any).value).toBe(strategy);
    });

    it('returns error for unknown id', () => {
      const registry = makeRegistry();
      const result = registry.get('unknown');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('getVersion()', () => {
    it('returns the strategy version', () => {
      const registry = makeRegistry();
      const strategy = makeStrategy();
      registry.register(strategy);
      const result = registry.getVersion(strategy.id);
      expect(result.isOk()).toBe(true);
      expect((result as any).value).toBe('1.0.0');
    });

    it('returns error for unknown id', () => {
      const registry = makeRegistry();
      const result = registry.getVersion('ghost');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('getHealth()', () => {
    it('reports correct counts', () => {
      const registry = makeRegistry();
      registry.register(makeStrategy('s1'));
      registry.register(makeStrategy('s2'));
      registry.enable('s1');

      const health = registry.getHealth();
      expect(health.totalRegistered).toBe(2);
      expect(health.enabled).toBe(1);
      expect(health.inError).toBe(0);
      expect(health.strategies).toHaveLength(2);
    });

    it('counts error state strategies', async () => {
      class ErrorOnWarmup extends BaseStrategy {
        constructor(config: StrategyPluginConfig) {
          super(config);
        }
        protected override async onWarmup() {
          throw new Error('warmup fail');
        }
        protected override async doGenerateSignal(_ctx: StrategyContext): Promise<Signal | null> {
          return null;
        }
      }

      const registry = makeRegistry();
      const strategy = new ErrorOnWarmup(makeConfig('err-1'));
      registry.register(strategy);

      await strategy
        .warmup({
          exchange: 'binance',
          symbol: 'BTC/USDT',
          timestamp: Date.now(),
          indicators: new Map(),
        })
        .catch(() => {});

      const health = registry.getHealth();
      expect(health.inError).toBe(1);
      expect(health.byState[StrategyState.ERROR]).toBe(1);
    });
  });
});
