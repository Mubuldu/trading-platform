/**
 * SdkStrategyAdapter — bridges the platform's BaseStrategy interface to an SdkStrategy
 * provided by a third-party plugin author.
 *
 * ## Responsibility
 *
 *   The adapter owns the boundary between the platform's internal type system and
 *   the SDK's stable public type system. It:
 *
 *     1. Converts platform types → SDK types on all inbound hooks (toSdk*)
 *     2. Converts SDK types → platform types on outbound signals (fromSdk*)
 *     3. Routes all SdkStrategy hook calls through PluginSandbox for:
 *        - error isolation (one crash ≠ platform crash)
 *        - timeout enforcement (maxRuntimeMs from manifest.riskLimits)
 *        - rate limiting (maxEventsPerSecond from manifest.riskLimits)
 *        - log capture (strategy.log() messages are surfaced via AppLoggerService)
 *     4. Records every execution report into SdkContextProviderService's ring buffer
 *        so strategies can access recent fills via ctx.executionReports
 *     5. Forwards position updates to the strategy's onPositionUpdate hook
 *        (both open and close events)
 *
 * ## Lifecycle
 *
 *   The adapter is created by the PluginLifecycleManagerService when a plugin is
 *   installed. It is registered with the StrategyRegistryService and receives the
 *   same events as any other platform strategy. On unload, the adapter calls
 *   sandbox.shutdown(), then unregisters.
 *
 * ## Thread safety
 *
 *   All methods run on the Node.js event loop. PluginSandbox is not thread-safe,
 *   and no concurrent calls happen under normal operation.
 */

import { AppLoggerService } from '@core/logging/app-logger.service';
import { MarketTick, Trade } from '@modules/exchange/models/market.models';
import { ExecutionReport } from '@modules/exchange/models/trading.models';
import { Position } from '@modules/exchange/models/account.models';
import { Candle } from '@modules/indicator/domain/models/candle.model';
import { BaseStrategy } from '@modules/strategy/framework/base-strategy';
import {
  StrategyContext,
  StrategyPluginConfig,
} from '@modules/strategy/interfaces/strategy.interface';
import { Signal } from '@modules/strategy/interfaces/signal.interface';
import { ok, err } from '@common/result';
import { Result } from '@common/result';
import { StrategyConfigValidationError } from '@modules/strategy/domain/errors/strategy.errors';
import {
  SdkStrategy,
  PluginSandbox,
  PluginSandboxConfig,
  StrategyPermission,
} from '@trading-platform/strategy-sdk';
import {
  toSdkCandle,
  toSdkTick,
  toSdkTrade,
  toSdkExecutionReport,
  toSdkOpenPosition,
  fromSdkSignal,
} from './type-adapters';
import { SdkContextProviderService } from '../services/sdk-context-provider.service';

// Default resource limits when not specified in manifest.riskLimits
const DEFAULT_MAX_RUNTIME_MS = 5_000;
const DEFAULT_MAX_EVENTS_PER_SECOND = 100;

/**
 * SdkStrategyAdapter wraps a user-provided SdkStrategy (loaded from a plugin package)
 * in the platform's BaseStrategy interface, routing all hook calls through PluginSandbox.
 *
 * Instantiated by PluginLifecycleManagerService via:
 *   new SdkStrategyAdapter(sdkStrategy, platformConfig, contextProvider, logger, exchangeId)
 */
export class SdkStrategyAdapter extends BaseStrategy {
  private readonly sandbox: PluginSandbox;
  private readonly permissions: ReadonlySet<StrategyPermission>;
  private readonly exchangeId: string;

  constructor(
    private readonly sdkStrategy: SdkStrategy,
    config: StrategyPluginConfig,
    private readonly contextProvider: SdkContextProviderService,
    private readonly logger: AppLoggerService,
    exchangeId: string,
  ) {
    super(config);
    this.exchangeId = exchangeId;

    // Build the sandbox config from manifest riskLimits, falling back to platform config
    const riskLimits = sdkStrategy.manifest.riskLimits;
    const sandboxConfig: PluginSandboxConfig = {
      strategyId: config.strategyId,
      maxRuntimeMs:
        riskLimits?.maxRuntimeMs ?? config.resourceLimits.maxRuntimeMs ?? DEFAULT_MAX_RUNTIME_MS,
      maxEventsPerSecond:
        riskLimits?.maxEventsPerSecond ??
        config.resourceLimits.maxEventsPerSecond ??
        DEFAULT_MAX_EVENTS_PER_SECOND,
    };

    this.sandbox = new PluginSandbox(sdkStrategy, sandboxConfig);

    // Build a fast-lookup permission set from the manifest
    this.permissions = new Set(sdkStrategy.manifest.permissions as StrategyPermission[]);
  }

  // ── Configuration ─────────────────────────────────────────────────────────────

  /**
   * Delegates configuration validation to the SdkStrategy's validateConfig() hook.
   * Converts SdkConfigValidationError → platform StrategyConfigValidationError.
   */
  protected override doValidateConfiguration(
    config: StrategyPluginConfig,
  ): Result<void, StrategyConfigValidationError> {
    const result = this.sdkStrategy.validateConfig(config.parameters);
    if (result.success) return ok(undefined);

    return err(new StrategyConfigValidationError(config.strategyId, result.error.message));
  }

  // ── Lifecycle hooks ───────────────────────────────────────────────────────────

  protected override async onInitialize(): Promise<void> {
    const ctx = this.contextProvider.buildSdkInitContext(this._config);
    const result = await this.sandbox.initialize(ctx);
    this.flushLogs(result.logs);
    if (!result.success) {
      throw result.error ?? new Error('SdkStrategy.onInitialize() failed without error detail');
    }
  }

  protected override async onWarmup(_platformCtx: StrategyContext): Promise<void> {
    const ctx = this.contextProvider.buildSdkWarmupContext(this._config, this.exchangeId);
    const result = await this.sandbox.warmup(ctx);
    this.flushLogs(result.logs);
    if (!result.success) {
      throw result.error ?? new Error('SdkStrategy.onWarmup() failed without error detail');
    }
    // Sync warmup progress back to BaseStrategy's metrics tracker
    this.setWarmupProgress(this.sandbox.getWarmupProgress());
  }

  protected override async onShutdown(): Promise<void> {
    const result = await this.sandbox.shutdown();
    this.flushLogs(result.logs);
    // Shutdown errors are logged but not re-thrown — plugin is being unloaded
    if (!result.success) {
      this.logger.error(
        `SdkStrategy "${this.id}" shutdown error: ${result.error?.message ?? 'unknown'}`,
        result.error?.stack,
        SdkStrategyAdapter.name,
      );
    }
  }

  // ── Market event hooks ────────────────────────────────────────────────────────

  protected override async doOnCandle(candle: Candle): Promise<void> {
    const result = await this.sandbox.onCandle(toSdkCandle(candle));
    this.flushLogs(result.logs);
    if (!result.success) this.logSandboxError('onCandle', result.error);
  }

  protected override async doOnTick(tick: MarketTick): Promise<void> {
    // Also feed the tick into the context provider so ctx.marketData stays current
    this.contextProvider.recordTick(tick);

    const result = await this.sandbox.onTick(toSdkTick(tick));
    this.flushLogs(result.logs);
    if (!result.success) this.logSandboxError('onTick', result.error);
  }

  protected override async doOnTrade(trade: Trade): Promise<void> {
    // Feed the trade into the context provider
    this.contextProvider.recordTrade(trade);

    const result = await this.sandbox.onTrade(toSdkTrade(trade));
    this.flushLogs(result.logs);
    if (!result.success) this.logSandboxError('onTrade', result.error);
  }

  // ── Execution hooks ───────────────────────────────────────────────────────────

  protected override async doOnOrderFilled(report: ExecutionReport): Promise<void> {
    // Record into the execution ring buffer BEFORE dispatching to the strategy
    // so that ctx.executionReports in the same generateSignal() cycle is up to date
    this.contextProvider.recordExecution(report, this.id);

    const sdkReport = toSdkExecutionReport(report, this.id);
    const result = await this.sandbox.onOrderFilled(sdkReport);
    this.flushLogs(result.logs);
    if (!result.success) this.logSandboxError('onOrderFilled', result.error);
  }

  protected override async doOnOrderRejected(report: ExecutionReport): Promise<void> {
    this.contextProvider.recordExecution(report, this.id);

    const sdkReport = toSdkExecutionReport(report, this.id);
    const result = await this.sandbox.onOrderRejected(sdkReport);
    this.flushLogs(result.logs);
    if (!result.success) this.logSandboxError('onOrderRejected', result.error);
  }

  protected override async doOnPositionOpened(position: Position): Promise<void> {
    const result = await this.sandbox.onPositionUpdate(toSdkOpenPosition(position));
    this.flushLogs(result.logs);
    if (!result.success) this.logSandboxError('onPositionOpened', result.error);
  }

  protected override async doOnPositionClosed(position: Position): Promise<void> {
    const result = await this.sandbox.onPositionUpdate(toSdkOpenPosition(position));
    this.flushLogs(result.logs);
    if (!result.success) this.logSandboxError('onPositionClosed', result.error);
  }

  // ── Signal generation ─────────────────────────────────────────────────────────

  /**
   * Converts the platform's StrategyContext into an SdkStrategyContext, calls the
   * sandbox's generateSignal(), and converts the returned SdkSignal into a platform
   * Signal. Returns null if the sandbox is rate-limited, the strategy returns null,
   * or an error occurs.
   */
  protected override async doGenerateSignal(platformCtx: StrategyContext): Promise<Signal | null> {
    const sdkCtx = this.contextProvider.buildSdkStrategyContext(
      platformCtx,
      this.id,
      this.exchangeId,
      this.permissions,
    );

    const result = await this.sandbox.generateSignal(sdkCtx);
    this.flushLogs(result.logs);

    if (!result.success) {
      this.logSandboxError('generateSignal', result.error);
      return null;
    }

    if (!result.value) return null;

    return fromSdkSignal(result.value, this.id, this.exchangeId);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  /**
   * Emits log messages captured by the sandbox into the platform logger.
   * All strategy messages are tagged with the strategy ID for traceability.
   */
  private flushLogs(logs: readonly string[]): void {
    for (const msg of logs) {
      this.logger.debug(msg, `strategy:${this.id}`);
    }
  }

  private logSandboxError(hook: string, error: Error | null): void {
    this.logger.warn(
      `SdkStrategy "${this.id}" ${hook}: ${error?.message ?? 'unknown error'} (sandbox isolated)`,
      SdkStrategyAdapter.name,
    );
  }
}
