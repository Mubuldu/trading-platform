/**
 * PluginLifecycleManagerService — manages the complete lifecycle of SDK strategy plugins.
 *
 * ## Lifecycle states (from SDK PluginLifecycleState)
 *
 *   REGISTERED → VALIDATED → COMPILED (skipped for in-process) → LOADED →
 *   INITIALIZED → WARMED_UP → RUNNING ↔ PAUSED →
 *   UNLOADED → REMOVED
 *
 *   Any state → ERROR → REMOVED (on unrecoverable failure)
 *
 * ## Responsibilities
 *
 *   - Install: validate → wrap in SdkStrategyAdapter → register with StrategyRegistryService
 *   - Uninstall: shutdown adapter → unregister → remove from internal registry
 *   - Pause / Resume: toggle strategy enabled flag via StrategyRegistryService
 *   - Health: expose lifecycle state + sandbox metrics for all managed plugins
 *
 * ## Relationship to the existing strategy system
 *
 *   SdkStrategyAdapter extends BaseStrategy and is registered in StrategyRegistryService
 *   like any other platform strategy. The existing StrategySchedulerService dispatches
 *   events to it without knowing it is an SDK-backed adapter. This keeps the integration
 *   transparent and avoids modifying the scheduler or registry.
 *
 * ## Error handling
 *
 *   - Validation failures → throws PluginInstallError; strategy is not registered
 *   - Initialize / warmup failures → strategy transitions to ERROR state; still registered,
 *     but not enabled; caller can uninstall and retry
 *   - Runtime errors → isolated by PluginSandbox; do not propagate to this service
 */

import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import {
  SdkStrategy,
  PluginLifecycleState,
  StrategyPermission,
} from '@trading-platform/strategy-sdk';
import { StrategyRegistryService } from '@modules/strategy/registry/strategy-registry.service';
import { StrategyPluginConfig } from '@modules/strategy/interfaces/strategy.interface';
import { StrategyState } from '@modules/strategy/domain/enums/strategy-state.enum';
import { SdkStrategyAdapter } from '../adapters/sdk-strategy-adapter';
import { PluginValidationService } from './plugin-validation.service';
import { SdkContextProviderService } from './sdk-context-provider.service';

// ── Plugin install errors ─────────────────────────────────────────────────────

export class PluginInstallError extends Error {
  constructor(
    public readonly pluginId: string,
    public readonly issues: ReadonlyArray<{ field: string; message: string }>,
  ) {
    super(
      `Plugin "${pluginId}" failed installation (${issues.length} issue(s)): ` +
        issues.map((i) => `${i.field}: ${i.message}`).join('; '),
    );
    this.name = 'PluginInstallError';
  }
}

// ── Plugin entry ──────────────────────────────────────────────────────────────

interface PluginEntry {
  readonly pluginId: string;
  readonly adapter: SdkStrategyAdapter;
  readonly strategy: SdkStrategy;
  readonly config: StrategyPluginConfig;
  readonly exchange: string;
  lifecycleState: PluginLifecycleState;
  installedAt: number;
  lastError: string | null;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class PluginLifecycleManagerService {
  private readonly ctx = PluginLifecycleManagerService.name;

  /** Registry of all managed plugins, keyed by pluginId (= strategyId). */
  private readonly plugins = new Map<string, PluginEntry>();

  constructor(
    private readonly logger: AppLoggerService,
    private readonly registry: StrategyRegistryService,
    private readonly validator: PluginValidationService,
    private readonly contextProvider: SdkContextProviderService,
  ) {}

  // ── Public API ────────────────────────────────────────────────────────────────

  /**
   * Install a plugin through the full lifecycle:
   *   REGISTERED → VALIDATED → LOADED → INITIALIZED → WARMED_UP → RUNNING
   *
   * @param strategy   — instantiated SdkStrategy (the plugin class instance)
   * @param config     — platform configuration for this strategy instance
   * @param exchangeId — exchange the strategy will run on (e.g. "binance-futures")
   *
   * @throws PluginInstallError if validation fails (strategy not registered)
   * @throws Error if initialization or warmup fails (strategy registered in ERROR state)
   */
  async install(
    strategy: SdkStrategy,
    config: StrategyPluginConfig,
    exchangeId: string,
  ): Promise<void> {
    const pluginId = config.strategyId;
    this.logger.log(`Plugin install started: "${pluginId}"`, this.ctx);

    // ── REGISTERED ─────────────────────────────────────────────────────────────
    if (this.plugins.has(pluginId)) {
      throw new Error(`Plugin "${pluginId}" is already installed. Uninstall it first.`);
    }

    // ── VALIDATED ──────────────────────────────────────────────────────────────
    const validation = this.validator.validate(strategy);
    if (!validation.valid) {
      throw new PluginInstallError(pluginId, validation.issues);
    }
    this.logger.log(`Plugin "${pluginId}" passed validation`, this.ctx);

    // ── LOADED — wrap in adapter ────────────────────────────────────────────────
    const adapter = new SdkStrategyAdapter(
      strategy,
      config,
      this.contextProvider,
      this.logger,
      exchangeId,
    );

    const entry: PluginEntry = {
      pluginId,
      adapter,
      strategy,
      config,
      exchange: exchangeId,
      lifecycleState: PluginLifecycleState.LOADED,
      installedAt: Date.now(),
      lastError: null,
    };
    this.plugins.set(pluginId, entry);

    // Register with the platform registry so the scheduler starts dispatching events
    const registerResult = this.registry.register(adapter);
    if (registerResult.isErr()) {
      this.plugins.delete(pluginId);
      throw new Error(
        `Plugin "${pluginId}" registry registration failed: ${registerResult.error.message}`,
      );
    }

    // ── INITIALIZED ────────────────────────────────────────────────────────────
    try {
      entry.lifecycleState = PluginLifecycleState.INITIALIZED;
      await adapter.initialize();
      this.logger.log(`Plugin "${pluginId}" initialized`, this.ctx);
    } catch (e) {
      entry.lifecycleState = PluginLifecycleState.ERROR;
      entry.lastError = e instanceof Error ? e.message : String(e);
      this.logger.error(
        `Plugin "${pluginId}" initialization failed: ${entry.lastError}`,
        e instanceof Error ? e.stack : undefined,
        this.ctx,
      );
      throw e;
    }

    // ── WARMED_UP ──────────────────────────────────────────────────────────────
    try {
      entry.lifecycleState = PluginLifecycleState.WARMED_UP;
      const platformCtx = this.buildMinimalWarmupPlatformCtx(config, exchangeId);
      await adapter.warmup(platformCtx);
      this.logger.log(`Plugin "${pluginId}" warmup complete`, this.ctx);
    } catch (e) {
      entry.lifecycleState = PluginLifecycleState.ERROR;
      entry.lastError = e instanceof Error ? e.message : String(e);
      this.logger.error(
        `Plugin "${pluginId}" warmup failed: ${entry.lastError}`,
        e instanceof Error ? e.stack : undefined,
        this.ctx,
      );
      throw e;
    }

    // ── RUNNING ────────────────────────────────────────────────────────────────
    adapter.setEnabled(true);
    entry.lifecycleState = PluginLifecycleState.RUNNING;
    this.logger.log(`Plugin "${pluginId}" is now RUNNING`, this.ctx);
  }

  /**
   * Pause a running plugin. The strategy stops receiving new events but remains
   * registered and in memory. Call resume() to restart dispatching.
   */
  pause(pluginId: string): void {
    const entry = this.requireEntry(pluginId);
    if (entry.lifecycleState !== PluginLifecycleState.RUNNING) {
      throw new Error(`Cannot pause plugin "${pluginId}" — current state: ${entry.lifecycleState}`);
    }
    entry.adapter.setEnabled(false);
    entry.lifecycleState = PluginLifecycleState.PAUSED;
    this.logger.log(`Plugin "${pluginId}" paused`, this.ctx);
  }

  /**
   * Resume a paused plugin. Events will resume dispatching immediately.
   */
  resume(pluginId: string): void {
    const entry = this.requireEntry(pluginId);
    if (entry.lifecycleState !== PluginLifecycleState.PAUSED) {
      throw new Error(
        `Cannot resume plugin "${pluginId}" — current state: ${entry.lifecycleState}`,
      );
    }
    entry.adapter.setEnabled(true);
    entry.lifecycleState = PluginLifecycleState.RUNNING;
    this.logger.log(`Plugin "${pluginId}" resumed`, this.ctx);
  }

  /**
   * Uninstall a plugin: shutdown → unregister → remove from internal registry.
   *
   * Safe to call on a plugin in any lifecycle state. If the strategy is in ERROR
   * state, shutdown is still attempted (and errors are swallowed).
   */
  async uninstall(pluginId: string): Promise<void> {
    const entry = this.requireEntry(pluginId);
    this.logger.log(`Plugin uninstall started: "${pluginId}"`, this.ctx);

    // Disable first so no new events are dispatched during shutdown
    entry.adapter.setEnabled(false);
    entry.lifecycleState = PluginLifecycleState.UNLOADED;

    // Attempt graceful shutdown
    try {
      await entry.adapter.shutdown();
    } catch (e) {
      this.logger.warn(
        `Plugin "${pluginId}" shutdown error (ignored): ${e instanceof Error ? e.message : String(e)}`,
        this.ctx,
      );
    }

    // Unregister from the platform registry
    const unregisterResult = this.registry.unregister(pluginId);
    if (unregisterResult.isErr()) {
      this.logger.warn(
        `Plugin "${pluginId}" unregister failed: ${unregisterResult.error.message}`,
        this.ctx,
      );
    }

    this.plugins.delete(pluginId);
    this.logger.log(`Plugin "${pluginId}" uninstalled`, this.ctx);
  }

  // ── Health / observability ────────────────────────────────────────────────────

  /**
   * Returns the lifecycle state and health of all managed plugins.
   */
  getPluginHealth(): PluginHealthSummary[] {
    return [...this.plugins.values()].map((entry) => ({
      pluginId: entry.pluginId,
      name: entry.strategy.manifest.name,
      version: entry.strategy.manifest.version,
      lifecycleState: entry.lifecycleState,
      strategyState: entry.adapter.state,
      installedAt: entry.installedAt,
      lastError: entry.lastError,
      metrics: entry.adapter.getMetrics(),
      permissions: entry.strategy.manifest.permissions as StrategyPermission[],
    }));
  }

  getPlugin(pluginId: string): PluginEntry | undefined {
    return this.plugins.get(pluginId);
  }

  isInstalled(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }

  listPluginIds(): string[] {
    return [...this.plugins.keys()];
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private requireEntry(pluginId: string): PluginEntry {
    const entry = this.plugins.get(pluginId);
    if (!entry) throw new Error(`Plugin "${pluginId}" is not installed`);
    return entry;
  }

  /**
   * Builds a minimal platform StrategyContext for the warmup call.
   *
   * The SdkStrategyAdapter's warmup override ignores the StrategyContext argument
   * entirely (it uses SdkContextProviderService.buildSdkWarmupContext instead),
   * so this object only needs to satisfy the type signature.
   */
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  private buildMinimalWarmupPlatformCtx(config: StrategyPluginConfig, exchangeId: string) {
    return {
      exchange: exchangeId,
      symbol: config.enabledSymbols[0] ?? '',
      timestamp: Date.now(),
      indicators: new Map(),
    };
  }
}

// ── Public health summary type ────────────────────────────────────────────────

export interface PluginHealthSummary {
  readonly pluginId: string;
  readonly name: string;
  readonly version: string;
  readonly lifecycleState: PluginLifecycleState;
  readonly strategyState: StrategyState;
  readonly installedAt: number;
  readonly lastError: string | null;
  readonly metrics: ReturnType<SdkStrategyAdapter['getMetrics']>;
  readonly permissions: StrategyPermission[];
}
