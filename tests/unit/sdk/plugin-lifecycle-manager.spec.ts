import {
  PluginLifecycleManagerService,
  PluginInstallError,
} from '@modules/plugin/services/plugin-lifecycle-manager.service';
import { PluginValidationService } from '@modules/plugin/services/plugin-validation.service';
import { SdkContextProviderService } from '@modules/plugin/services/sdk-context-provider.service';
import { StrategyRegistryService } from '@modules/strategy/registry/strategy-registry.service';
import {
  SdkStrategy,
  PluginManifest,
  SdkStrategyContext,
  SdkSignal,
  StrategyPermission,
  PluginLifecycleState,
} from '@trading-platform/strategy-sdk';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { ok, err } from '@common/result';
import { StrategyAlreadyRegisteredError } from '@modules/strategy/domain/errors/strategy.errors';
import { StrategyPluginConfig } from '@modules/strategy/interfaces/strategy.interface';

// ── Helpers ────────────────────────────────────────────────────────────────────

const VALID_MANIFEST: PluginManifest = {
  id: 'lifecycle-test-v1',
  name: 'Lifecycle Test',
  version: '1.0.0',
  author: { name: 'Test' },
  license: 'MIT',
  description: 'Lifecycle manager unit test strategy.',
  requiredSdkVersion: '^1.0.0',
  permissions: [StrategyPermission.GENERATE_SIGNALS],
  riskLimits: { maxRuntimeMs: 500, maxEventsPerSecond: 100 },
};

class TestStrategy extends SdkStrategy {
  readonly manifest: PluginManifest = VALID_MANIFEST;
  protected async generateSignal(_ctx: SdkStrategyContext): Promise<SdkSignal | null> {
    return null;
  }
}

function makeConfig(strategyId = 'lifecycle-test-v1'): StrategyPluginConfig {
  return {
    strategyId,
    name: 'Lifecycle Test',
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
    resourceLimits: { maxRuntimeMs: 500, maxEventsPerSecond: 100 },
  };
}

function makeLogger(): jest.Mocked<AppLoggerService> {
  return {
    log: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    verbose: jest.fn(),
  } as unknown as jest.Mocked<AppLoggerService>;
}

function makeRegistry(): jest.Mocked<StrategyRegistryService> {
  return {
    register: jest.fn().mockReturnValue(ok(undefined)),
    unregister: jest.fn().mockReturnValue(ok(undefined)),
    getEnabled: jest.fn().mockReturnValue([]),
    getAll: jest.fn().mockReturnValue([]),
    getHealth: jest.fn(),
  } as unknown as jest.Mocked<StrategyRegistryService>;
}

function makeValidator(valid = true): jest.Mocked<PluginValidationService> {
  return {
    validate: jest.fn().mockReturnValue({
      valid,
      issues: valid ? [] : [{ phase: 'manifest', field: 'id', message: 'Bad id' }],
    }),
  } as unknown as jest.Mocked<PluginValidationService>;
}

function makeContextProvider(): jest.Mocked<SdkContextProviderService> {
  return {
    buildSdkInitContext: jest.fn().mockReturnValue({
      strategyId: 'test',
      symbol: 'BTC/USDT',
      exchange: 'binance',
      parameters: {},
    }),
    buildSdkWarmupContext: jest.fn().mockReturnValue({
      strategyId: 'test',
      symbol: 'BTC/USDT',
      exchange: 'binance',
      parameters: {},
      historical: { getCandles: jest.fn().mockResolvedValue([]) },
    }),
    buildSdkStrategyContext: jest.fn(),
    recordTick: jest.fn(),
    recordTrade: jest.fn(),
    recordOrderBook: jest.fn(),
    recordExecution: jest.fn(),
  } as unknown as jest.Mocked<SdkContextProviderService>;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('PluginLifecycleManagerService', () => {
  let manager: PluginLifecycleManagerService;
  let logger: jest.Mocked<AppLoggerService>;
  let registry: jest.Mocked<StrategyRegistryService>;
  let validator: jest.Mocked<PluginValidationService>;
  let contextProvider: jest.Mocked<SdkContextProviderService>;

  beforeEach(() => {
    logger = makeLogger();
    registry = makeRegistry();
    validator = makeValidator(true);
    contextProvider = makeContextProvider();

    manager = new PluginLifecycleManagerService(logger, registry, validator, contextProvider);
  });

  // ── install ──────────────────────────────────────────────────────────────────

  describe('install', () => {
    it('installs a valid strategy and transitions to RUNNING', async () => {
      const strategy = new TestStrategy();
      const config = makeConfig();

      await manager.install(strategy, config, 'binance-futures');

      expect(manager.isInstalled(config.strategyId)).toBe(true);

      const health = manager.getPluginHealth();
      const entry = health.find((h) => h.pluginId === config.strategyId);
      expect(entry?.lifecycleState).toBe(PluginLifecycleState.RUNNING);
    });

    it('registers the adapter with the strategy registry', async () => {
      await manager.install(new TestStrategy(), makeConfig(), 'binance');
      expect(registry.register).toHaveBeenCalledTimes(1);
    });

    it('throws PluginInstallError when validation fails', async () => {
      const badValidator = makeValidator(false);
      const mgr = new PluginLifecycleManagerService(
        logger,
        registry,
        badValidator,
        contextProvider,
      );

      await expect(mgr.install(new TestStrategy(), makeConfig(), 'binance')).rejects.toBeInstanceOf(
        PluginInstallError,
      );
    });

    it('throws when plugin with same ID is already installed', async () => {
      await manager.install(new TestStrategy(), makeConfig(), 'binance');
      await expect(manager.install(new TestStrategy(), makeConfig(), 'binance')).rejects.toThrow(
        /already installed/i,
      );
    });

    it('throws when registry registration fails', async () => {
      registry.register.mockReturnValue(
        err(new StrategyAlreadyRegisteredError('lifecycle-test-v1')),
      );
      await expect(manager.install(new TestStrategy(), makeConfig(), 'binance')).rejects.toThrow(
        /registry registration failed/i,
      );
    });
  });

  // ── pause / resume ────────────────────────────────────────────────────────────

  describe('pause / resume', () => {
    const ID = 'lifecycle-test-v1';

    beforeEach(async () => {
      await manager.install(new TestStrategy(), makeConfig(ID), 'binance');
    });

    it('pauses a running plugin', () => {
      expect(() => manager.pause(ID)).not.toThrow();
      const health = manager.getPluginHealth().find((h) => h.pluginId === ID);
      expect(health?.lifecycleState).toBe(PluginLifecycleState.PAUSED);
    });

    it('resumes a paused plugin', () => {
      manager.pause(ID);
      expect(() => manager.resume(ID)).not.toThrow();
      const health = manager.getPluginHealth().find((h) => h.pluginId === ID);
      expect(health?.lifecycleState).toBe(PluginLifecycleState.RUNNING);
    });

    it('throws when pausing a non-running plugin', () => {
      manager.pause(ID); // already paused now
      expect(() => manager.pause(ID)).toThrow(/cannot pause/i);
    });

    it('throws when resuming a running plugin', () => {
      expect(() => manager.resume(ID)).toThrow(/cannot resume/i);
    });

    it('throws for unknown plugin', () => {
      expect(() => manager.pause('no-such-plugin')).toThrow(/not installed/i);
    });
  });

  // ── uninstall ─────────────────────────────────────────────────────────────────

  describe('uninstall', () => {
    const ID = 'lifecycle-test-v1';

    beforeEach(async () => {
      await manager.install(new TestStrategy(), makeConfig(ID), 'binance');
    });

    it('removes the plugin from the internal registry', async () => {
      await manager.uninstall(ID);
      expect(manager.isInstalled(ID)).toBe(false);
    });

    it('calls unregister on the strategy registry', async () => {
      await manager.uninstall(ID);
      expect(registry.unregister).toHaveBeenCalledWith(ID);
    });

    it('throws for an uninstalled plugin', async () => {
      await manager.uninstall(ID);
      await expect(manager.uninstall(ID)).rejects.toThrow(/not installed/i);
    });
  });

  // ── getPluginHealth ───────────────────────────────────────────────────────────

  describe('getPluginHealth', () => {
    it('returns empty array when no plugins installed', () => {
      expect(manager.getPluginHealth()).toHaveLength(0);
    });

    it('returns health for each installed plugin', async () => {
      await manager.install(new TestStrategy(), makeConfig('p1'), 'binance');
      await manager.install(new TestStrategy(), makeConfig('p2'), 'binance');

      const health = manager.getPluginHealth();
      expect(health).toHaveLength(2);
      expect(health.map((h) => h.pluginId).sort()).toEqual(['p1', 'p2']);
    });
  });
});
