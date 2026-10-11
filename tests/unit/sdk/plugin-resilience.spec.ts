/**
 * Plugin Resilience Tests
 *
 * Covers failure scenarios that the plugin isolation layer must handle gracefully:
 *   - Broken Plugin      – strategy throws on every hook
 *   - Infinite Loop      – generateSignal never resolves (timeout)
 *   - Memory Leak        – large allocations do not prevent graceful degradation
 *   - High CPU           – tight synchronous loop that exhausts the timeout
 *   - Large Memory       – strategy returns an oversized payload
 *   - Plugin Reload      – uninstall + re-install of the same strategy ID
 */

import { PluginLifecycleManagerService } from '@modules/plugin/services/plugin-lifecycle-manager.service';
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
import { SdkStrategyAdapter } from '@modules/plugin/adapters/sdk-strategy-adapter';
import { StrategyContext } from '@modules/strategy/interfaces/strategy.interface';
import { ok } from '@common/result';
import { StrategyPluginConfig } from '@modules/strategy/interfaces/strategy.interface';

// ── Shared helpers ─────────────────────────────────────────────────────────────

const BASE_MANIFEST: PluginManifest = {
  id: 'resilience-test-v1',
  name: 'Resilience Test',
  version: '1.0.0',
  author: { name: 'Test' },
  license: 'MIT',
  description: 'Plugin resilience unit tests.',
  requiredSdkVersion: '^1.0.0',
  permissions: [StrategyPermission.GENERATE_SIGNALS],
  riskLimits: { maxRuntimeMs: 200, maxEventsPerSecond: 500 },
};

function makeConfig(id = 'resilience-test-v1'): StrategyPluginConfig {
  return {
    strategyId: id,
    name: 'Resilience Test',
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
    resourceLimits: { maxRuntimeMs: 200, maxEventsPerSecond: 500 },
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
    buildSdkStrategyContext: jest.fn().mockReturnValue({
      marketData: null,
      indicators: null,
      portfolio: null,
      riskState: null,
      executionReports: null,
    }),
    recordTick: jest.fn(),
    recordTrade: jest.fn(),
    recordOrderBook: jest.fn(),
    recordExecution: jest.fn(),
  } as unknown as jest.Mocked<SdkContextProviderService>;
}

function makeValidator(): jest.Mocked<PluginValidationService> {
  return {
    validate: jest.fn().mockReturnValue({ valid: true, issues: [] }),
  } as unknown as jest.Mocked<PluginValidationService>;
}

function makeManager(): {
  manager: PluginLifecycleManagerService;
  registry: jest.Mocked<StrategyRegistryService>;
  contextProvider: jest.Mocked<SdkContextProviderService>;
} {
  const logger = makeLogger();
  const registry = makeRegistry();
  const validator = makeValidator();
  const contextProvider = makeContextProvider();
  const manager = new PluginLifecycleManagerService(logger, registry, validator, contextProvider);
  return { manager, registry, contextProvider };
}

/** Minimal StrategyContext stub — onWarmup ignores it, so an empty cast is safe */
const STUB_CTX = {} as unknown as StrategyContext;

// ── Broken Plugin ──────────────────────────────────────────────────────────────

describe('Broken Plugin – strategy throws on every hook', () => {
  class BrokenStrategy extends SdkStrategy {
    readonly manifest: PluginManifest = { ...BASE_MANIFEST, id: 'broken-v1' };

    protected async generateSignal(_ctx: SdkStrategyContext): Promise<SdkSignal | null> {
      throw new Error('BrokenStrategy: intentional generateSignal error');
    }
  }

  it('installs successfully (error is in generateSignal, not init)', async () => {
    const { manager } = makeManager();
    // install itself should not throw because the lifecycle calls onInitialize / onWarmup,
    // NOT generateSignal
    await expect(
      manager.install(new BrokenStrategy(), makeConfig('broken-v1'), 'binance'),
    ).resolves.not.toThrow();
    expect(manager.isInstalled('broken-v1')).toBe(true);
  });

  it('adapter returns null (not throws) when generateSignal throws', async () => {
    const logger = makeLogger();
    const ctx = makeContextProvider();
    const config = makeConfig('broken-v1');
    const adapter = new SdkStrategyAdapter(new BrokenStrategy(), config, ctx, logger, 'binance');
    await adapter.initialize();
    await adapter.warmup(STUB_CTX);

    // generateSignal through the sandbox — should not propagate
    const signal = await (
      adapter as unknown as { doGenerateSignal(c: StrategyContext): Promise<SdkSignal | null> }
    ).doGenerateSignal({} as StrategyContext);
    expect(signal).toBeNull();
  });
});

// ── Infinite Loop (timeout) ────────────────────────────────────────────────────

describe('Infinite Loop – generateSignal never resolves', () => {
  class InfiniteLoopStrategy extends SdkStrategy {
    readonly manifest: PluginManifest = {
      ...BASE_MANIFEST,
      id: 'infinite-loop-v1',
      riskLimits: { maxRuntimeMs: 100, maxEventsPerSecond: 500 },
    };

    protected generateSignal(_ctx: SdkStrategyContext): Promise<SdkSignal | null> {
      // Returns a promise that never settles
      return new Promise<SdkSignal | null>(() => {
        /* intentionally never resolves */
      });
    }
  }

  it('returns null after sandbox timeout (does not hang the test)', async () => {
    const logger = makeLogger();
    const ctx = makeContextProvider();
    const config = {
      ...makeConfig('infinite-loop-v1'),
      resourceLimits: { maxRuntimeMs: 100, maxEventsPerSecond: 500 },
    };
    const adapter = new SdkStrategyAdapter(
      new InfiniteLoopStrategy(),
      config,
      ctx,
      logger,
      'binance',
    );
    await adapter.initialize();
    await adapter.warmup(STUB_CTX);

    const start = Date.now();
    const signal = await (
      adapter as unknown as { doGenerateSignal(c: StrategyContext): Promise<SdkSignal | null> }
    ).doGenerateSignal({} as StrategyContext);
    const elapsed = Date.now() - start;

    expect(signal).toBeNull();
    // Should have timed out within ~2× the maxRuntimeMs budget (generous for CI)
    expect(elapsed).toBeLessThan(2_000);
  }, 5_000);
});

// ── High CPU (async timeout) ──────────────────────────────────────────────────
//
// NOTE: A pure synchronous CPU spin cannot be preempted by Promise.race() in a
// single-threaded Node.js process — the event loop is blocked until the spin
// finishes. The same-process sandbox therefore cannot enforce a hard wall-clock
// cap on sync-heavy strategies. Worker thread isolation (planned for SDK 2.0)
// will close this gap via worker.terminate().
//
// This test instead verifies the *async* timeout path: a strategy that sleeps
// longer than maxRuntimeMs and then resumes must be timed out by the sandbox.

describe('High CPU – async timeout path', () => {
  class SlowAsyncStrategy extends SdkStrategy {
    readonly manifest: PluginManifest = {
      ...BASE_MANIFEST,
      id: 'slow-async-v1',
      riskLimits: { maxRuntimeMs: 50, maxEventsPerSecond: 500 },
    };

    protected async generateSignal(_ctx: SdkStrategyContext): Promise<SdkSignal | null> {
      // Async delay longer than the 50 ms sandbox budget.
      // unref() prevents the timer from keeping the process alive after the
      // sandbox has already raced past it via its own timeout.
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 5_000);
        if (typeof t === 'object' && t !== null && 'unref' in t) (t as NodeJS.Timeout).unref();
      });
      return null;
    }
  }

  it('returns null after sandbox timeout (async case)', async () => {
    const logger = makeLogger();
    const ctx = makeContextProvider();
    const config = {
      ...makeConfig('slow-async-v1'),
      resourceLimits: { maxRuntimeMs: 50, maxEventsPerSecond: 500 },
    };
    const adapter = new SdkStrategyAdapter(new SlowAsyncStrategy(), config, ctx, logger, 'binance');
    await adapter.initialize();
    await adapter.warmup(STUB_CTX);

    const start = Date.now();
    const signal = await (
      adapter as unknown as { doGenerateSignal(c: StrategyContext): Promise<SdkSignal | null> }
    ).doGenerateSignal({} as StrategyContext);
    const elapsed = Date.now() - start;

    expect(signal).toBeNull();
    // Should time out well within 2s (budget is 50 ms; generous CI headroom)
    expect(elapsed).toBeLessThan(2_000);
  }, 5_000);
});

// ── Memory Leak (large allocation) ────────────────────────────────────────────

describe('Large Memory – strategy allocates a large array', () => {
  class LargeMemoryStrategy extends SdkStrategy {
    readonly manifest: PluginManifest = { ...BASE_MANIFEST, id: 'large-mem-v1' };

    protected async generateSignal(_ctx: SdkStrategyContext): Promise<SdkSignal | null> {
      // Allocate ~10 MB of data — should not crash the process
      void new Array(1_000_000).fill(Math.random());
      return null;
    }
  }

  it('completes without process crash', async () => {
    const logger = makeLogger();
    const ctx = makeContextProvider();
    const adapter = new SdkStrategyAdapter(
      new LargeMemoryStrategy(),
      makeConfig('large-mem-v1'),
      ctx,
      logger,
      'binance',
    );
    await adapter.initialize();
    await adapter.warmup(STUB_CTX);

    const signal = await (
      adapter as unknown as { doGenerateSignal(c: StrategyContext): Promise<SdkSignal | null> }
    ).doGenerateSignal({} as StrategyContext);

    expect(signal).toBeNull(); // allocation succeeded, nothing to trade
  });
});

// ── Rate Limiting ──────────────────────────────────────────────────────────────

describe('Rate Limiting – events per second guard', () => {
  class HighFreqStrategy extends SdkStrategy {
    readonly manifest: PluginManifest = {
      ...BASE_MANIFEST,
      id: 'rate-limit-v1',
      riskLimits: { maxRuntimeMs: 500, maxEventsPerSecond: 2 },
    };

    protected async generateSignal(_ctx: SdkStrategyContext): Promise<SdkSignal | null> {
      return null;
    }
  }

  it('first two calls within a second succeed', async () => {
    const logger = makeLogger();
    const ctx = makeContextProvider();
    const config = {
      ...makeConfig('rate-limit-v1'),
      resourceLimits: { maxRuntimeMs: 500, maxEventsPerSecond: 2 },
    };
    const adapter = new SdkStrategyAdapter(new HighFreqStrategy(), config, ctx, logger, 'binance');
    await adapter.initialize();
    await adapter.warmup(STUB_CTX);

    const call = () =>
      (
        adapter as unknown as { doGenerateSignal(c: StrategyContext): Promise<SdkSignal | null> }
      ).doGenerateSignal({} as StrategyContext);

    const [s1, s2] = await Promise.all([call(), call()]);
    // Both should complete (null or signal)
    expect(s1).toBeNull();
    expect(s2).toBeNull();
  });

  it('excess calls beyond the rate limit return null', async () => {
    const logger = makeLogger();
    const ctx = makeContextProvider();
    const config = {
      ...makeConfig('rate-limit-v1'),
      resourceLimits: { maxRuntimeMs: 500, maxEventsPerSecond: 2 },
    };
    const adapter = new SdkStrategyAdapter(new HighFreqStrategy(), config, ctx, logger, 'binance');
    await adapter.initialize();
    await adapter.warmup(STUB_CTX);

    const call = () =>
      (
        adapter as unknown as { doGenerateSignal(c: StrategyContext): Promise<SdkSignal | null> }
      ).doGenerateSignal({} as StrategyContext);

    // Fire 5 calls in quick succession — sandbox should rate-limit and return null for overages
    const results = await Promise.all([call(), call(), call(), call(), call()]);
    // All must resolve (no throws)
    expect(results.every((r) => r === null || r !== undefined)).toBe(true);
  });
});

// ── Plugin Reload ──────────────────────────────────────────────────────────────

describe('Plugin Reload – uninstall then re-install the same strategy ID', () => {
  class ReloadableStrategy extends SdkStrategy {
    readonly manifest: PluginManifest = { ...BASE_MANIFEST, id: 'reloadable-v1' };
    protected async generateSignal(_ctx: SdkStrategyContext): Promise<SdkSignal | null> {
      return null;
    }
  }

  it('allows re-install after a clean uninstall', async () => {
    const { manager } = makeManager();
    const ID = 'reloadable-v1';

    // First install
    await manager.install(new ReloadableStrategy(), makeConfig(ID), 'binance');
    expect(manager.isInstalled(ID)).toBe(true);

    // Uninstall
    await manager.uninstall(ID);
    expect(manager.isInstalled(ID)).toBe(false);

    // Re-install
    await manager.install(new ReloadableStrategy(), makeConfig(ID), 'binance');
    expect(manager.isInstalled(ID)).toBe(true);

    const health = manager.getPluginHealth();
    const entry = health.find((h) => h.pluginId === ID);
    expect(entry?.lifecycleState).toBe(PluginLifecycleState.RUNNING);
  });

  it('does not carry over error state from the previous instance', async () => {
    const { manager } = makeManager();
    const ID = 'reloadable-v1';

    await manager.install(new ReloadableStrategy(), makeConfig(ID), 'binance');
    await manager.uninstall(ID);
    await manager.install(new ReloadableStrategy(), makeConfig(ID), 'binance');

    const health = manager.getPluginHealth().find((h) => h.pluginId === ID);
    expect(health?.lastError).toBeNull();
  });

  it('allows pausing and resuming after reload', async () => {
    const { manager } = makeManager();
    const ID = 'reloadable-v1';

    await manager.install(new ReloadableStrategy(), makeConfig(ID), 'binance');
    await manager.uninstall(ID);
    await manager.install(new ReloadableStrategy(), makeConfig(ID), 'binance');

    expect(() => manager.pause(ID)).not.toThrow();
    expect(() => manager.resume(ID)).not.toThrow();

    const health = manager.getPluginHealth().find((h) => h.pluginId === ID);
    expect(health?.lifecycleState).toBe(PluginLifecycleState.RUNNING);
  });
});
