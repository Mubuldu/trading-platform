import { StrategyLoaderService } from '../../../src/modules/strategy/loader/strategy-loader.service';
import { StrategyRegistryService } from '../../../src/modules/strategy/registry/strategy-registry.service';
import { BaseStrategy } from '../../../src/modules/strategy/framework/base-strategy';
import {
  StrategyPluginConfig,
  StrategyContext,
} from '../../../src/modules/strategy/interfaces/strategy.interface';
import { Signal } from '../../../src/modules/strategy/interfaces/signal.interface';

function makeConfig(id = 'loader-test-1'): StrategyPluginConfig {
  return {
    strategyId: id,
    name: 'Loader Test Strategy',
    version: '2.0.0',
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
    resourceLimits: {},
  };
}

class SimpleStrategy extends BaseStrategy {
  constructor(config: StrategyPluginConfig) {
    super(config);
  }
  protected override async doGenerateSignal(_ctx: StrategyContext): Promise<Signal | null> {
    return null;
  }
}

function makeLoader() {
  const registry = new StrategyRegistryService();
  const loader = new StrategyLoaderService(registry);
  return { loader, registry };
}

describe('StrategyLoaderService', () => {
  describe('registerFactory()', () => {
    it('registers a factory by type name', () => {
      const { loader } = makeLoader();
      loader.registerFactory('simple', (cfg) => new SimpleStrategy(cfg));
      expect(loader.hasFactory('simple')).toBe(true);
    });

    it('getRegisteredTypes() lists registered factories', () => {
      const { loader } = makeLoader();
      loader.registerFactory('alpha', (cfg) => new SimpleStrategy(cfg));
      loader.registerFactory('beta', (cfg) => new SimpleStrategy(cfg));
      expect(loader.getRegisteredTypes()).toContain('alpha');
      expect(loader.getRegisteredTypes()).toContain('beta');
    });
  });

  describe('load()', () => {
    it('instantiates and registers a strategy', async () => {
      const { loader, registry } = makeLoader();
      loader.registerFactory('simple', (cfg) => new SimpleStrategy(cfg));

      const strategy = await loader.load('simple', makeConfig());
      expect(strategy).toBeDefined();
      expect(strategy.id).toBe('loader-test-1');
      expect(registry.getAll()).toHaveLength(1);
    });

    it('throws when factory type is unknown', async () => {
      const { loader } = makeLoader();
      await expect(loader.load('unknown-type', makeConfig())).rejects.toThrow(
        'No factory registered for strategy type "unknown-type"',
      );
    });

    it('throws when strategy fails validation', async () => {
      const { err } = require('../../../src/common/result');
      const {
        StrategyConfigValidationError,
      } = require('../../../src/modules/strategy/domain/errors/strategy.errors');

      class RejectAllStrategy extends BaseStrategy {
        constructor(config: StrategyPluginConfig) {
          super(config);
        }
        protected override doValidateConfiguration(config: StrategyPluginConfig) {
          return err(new StrategyConfigValidationError(config.strategyId, 'always invalid'));
        }
        protected override async doGenerateSignal(_ctx: StrategyContext): Promise<Signal | null> {
          return null;
        }
      }

      const { loader } = makeLoader();
      loader.registerFactory('reject', (cfg) => new RejectAllStrategy(cfg));
      await expect(loader.load('reject', makeConfig('reject-1'))).rejects.toThrow('always invalid');
    });

    it('throws when trying to load same strategy id twice', async () => {
      const { loader } = makeLoader();
      loader.registerFactory('simple', (cfg) => new SimpleStrategy(cfg));
      await loader.load('simple', makeConfig('dup-id'));
      await expect(loader.load('simple', makeConfig('dup-id'))).rejects.toThrow(
        'already registered',
      );
    });
  });

  describe('loadAll()', () => {
    it('loads all valid entries', async () => {
      const { loader, registry } = makeLoader();
      loader.registerFactory('simple', (cfg) => new SimpleStrategy(cfg));

      const { loaded, failed } = await loader.loadAll([
        { strategyType: 'simple', config: makeConfig('a1') },
        { strategyType: 'simple', config: makeConfig('a2') },
      ]);

      expect(loaded).toEqual(['a1', 'a2']);
      expect(failed).toHaveLength(0);
      expect(registry.getAll()).toHaveLength(2);
    });

    it('collects failures without stopping other loads', async () => {
      const { loader, registry } = makeLoader();
      loader.registerFactory('simple', (cfg) => new SimpleStrategy(cfg));

      const { loaded, failed } = await loader.loadAll([
        { strategyType: 'simple', config: makeConfig('good-1') },
        { strategyType: 'unknown-type', config: makeConfig('bad-1') },
        { strategyType: 'simple', config: makeConfig('good-2') },
      ]);

      expect(loaded).toContain('good-1');
      expect(loaded).toContain('good-2');
      expect(failed).toHaveLength(1);
      expect(failed[0].strategyType).toBe('unknown-type');
      expect(registry.getAll()).toHaveLength(2);
    });

    it('returns empty arrays for empty input', async () => {
      const { loader } = makeLoader();
      const { loaded, failed } = await loader.loadAll([]);
      expect(loaded).toHaveLength(0);
      expect(failed).toHaveLength(0);
    });
  });
});
