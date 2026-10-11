import { PluginManifest } from '../plugin/manifest';
import { SdkStrategyContext } from '../context/sdk-strategy-context';
import { SdkInitContext, SdkWarmupContext } from '../context/sdk-init-context';
import { SdkCandle } from '../market/candle.types';
import { SdkTick, SdkTrade } from '../market/tick.types';
import { SdkExecutionReport } from '../market/execution.types';
import { SdkOpenPosition } from '../market/position.types';
import { SdkSignal } from '../market/signal.types';
import { SdkResult, sdkOk, SdkConfigValidationError } from './sdk-result';

/**
 * SdkStrategy is the abstract base class every third-party strategy must extend.
 *
 * ## What this class provides
 *
 *   - Lifecycle hook defaults (all return Promise<void> by default — override only what you need)
 *   - Protected helpers: this.skip(), this.log(), this.setWarmupProgress()
 *   - Internal state tracking: this.strategyId, this.isWarmedUp
 *   - validateConfig() hook with a sensible default (accept any config)
 *
 * ## What you MUST implement
 *
 *   - manifest — declare who you are and what permissions you need
 *   - generateSignal() — the core signal-generation logic
 *
 * ## What you SHOULD NOT do
 *
 *   - Call process.env — environment variables are not accessible from strategies
 *   - Use fs, net, http, crypto, child_process — file system and network are blocked
 *   - Hold references to ctx or its inner objects after generateSignal() returns
 *   - Import from '@nestjs/*', '@modules/*', '@infrastructure/*' — platform internals are hidden
 *   - Throw from any hook — errors are caught by the sandbox and treated as skip events
 *
 * ## Isolation guarantee
 *
 *   Every hook call runs inside the platform's PluginSandbox. Uncaught errors
 *   are caught by the sandbox and converted to error-state transitions. One
 *   strategy throwing NEVER propagates to other strategies, the execution engine,
 *   or the risk engine.
 *
 * ## Example
 *
 * ```typescript
 * import {
 *   SdkStrategy, PluginManifest, SdkStrategyContext, SdkSignal,
 *   SdkSignalDirection, StrategyPermission, indicatorKey, SdkIndicatorType,
 * } from '@trading-platform/strategy-sdk';
 *
 * export class MyStrategy extends SdkStrategy {
 *   readonly manifest: PluginManifest = {
 *     id: 'my-strategy-v1',
 *     name: 'My Strategy',
 *     version: '1.0.0',
 *     author: { name: 'Alice' },
 *     license: 'MIT',
 *     description: 'A simple example strategy.',
 *     requiredSdkVersion: '^1.0.0',
 *     permissions: [StrategyPermission.READ_INDICATORS, StrategyPermission.GENERATE_SIGNALS],
 *   };
 *
 *   protected async generateSignal(ctx: SdkStrategyContext): Promise<SdkSignal | null> {
 *     const ema = ctx.indicators.get(indicatorKey(SdkIndicatorType.EMA, ctx.symbol, '1h', 50));
 *     if (!ema || ema.type !== SdkIndicatorType.EMA) return null;
 *     if (ema.value > 50000) {
 *       return { symbol: ctx.symbol, direction: SdkSignalDirection.BUY, confidence: 0.7,
 *                reason: 'EMA above 50k', metadata: { ema: ema.value } };
 *     }
 *     return null;
 *   }
 * }
 * ```
 */
export abstract class SdkStrategy {
  /**
   * The plugin manifest. Must be a static property — the platform reads it
   * before the strategy instance is fully constructed.
   */
  abstract readonly manifest: PluginManifest;

  /** Set by the platform after initialize(); strategies may read this. */
  protected strategyId = '';

  /** True once onWarmup() has completed successfully. */
  protected isWarmedUp = false;

  private _skippedEvents = 0;
  private _warmupProgress = 0;
  private _logBuffer: string[] = [];

  // ---------------------------------------------------------------------------
  // Platform-internal lifecycle hooks — called by the SdkStrategyAdapter.
  // These must NOT be overridden by strategy authors.
  // ---------------------------------------------------------------------------

  /** @internal */
  async _initialize(ctx: SdkInitContext): Promise<void> {
    this.strategyId = ctx.strategyId;
    await this.onInitialize(ctx);
  }

  /** @internal */
  async _warmup(ctx: SdkWarmupContext): Promise<void> {
    await this.onWarmup(ctx);
    this.isWarmedUp = true;
    this._warmupProgress = 1;
  }

  /** @internal */
  async _onCandle(candle: SdkCandle): Promise<void> {
    await this.onCandle(candle);
  }

  /** @internal */
  async _onTick(tick: SdkTick): Promise<void> {
    await this.onTick(tick);
  }

  /** @internal */
  async _onTrade(trade: SdkTrade): Promise<void> {
    await this.onTrade(trade);
  }

  /** @internal */
  async _onOrderFilled(report: SdkExecutionReport): Promise<void> {
    await this.onOrderFilled(report);
  }

  /** @internal */
  async _onOrderRejected(report: SdkExecutionReport): Promise<void> {
    await this.onOrderRejected(report);
  }

  /** @internal */
  async _onPositionUpdate(position: SdkOpenPosition): Promise<void> {
    await this.onPositionUpdate(position);
  }

  /** @internal */
  async _generateSignal(ctx: SdkStrategyContext): Promise<SdkSignal | null> {
    return this.generateSignal(ctx);
  }

  /** @internal */
  async _shutdown(): Promise<void> {
    await this.onShutdown();
  }

  /** @internal */
  _getWarmupProgress(): number {
    return this._warmupProgress;
  }

  /** @internal */
  _getSkippedEvents(): number {
    return this._skippedEvents;
  }

  /** @internal */
  _drainLogs(): string[] {
    const logs = [...this._logBuffer];
    this._logBuffer = [];
    return logs;
  }

  // ---------------------------------------------------------------------------
  // Configuration validation — override to add parameter constraints
  // ---------------------------------------------------------------------------

  /**
   * validateConfig() is called by the platform before loading the strategy.
   *
   * Override this to validate your custom parameter shape. Return sdkErr() with a
   * SdkConfigValidationError if validation fails — the strategy will not load.
   *
   * The default implementation accepts any config without inspection.
   *
   * @param _config — the raw parameters object from StrategyPluginConfig.parameters
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  validateConfig(_config: unknown): SdkResult<void, SdkConfigValidationError> {
    return sdkOk(undefined);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle hooks — override the ones your strategy needs
  // ---------------------------------------------------------------------------

  /**
   * Called once during the LOADED → INITIALIZED transition.
   *
   * Use this to allocate internal data structures and validate parameters.
   * No market data is available yet. Throwing here marks the plugin as ERROR.
   */
  protected async onInitialize(_ctx: SdkInitContext): Promise<void> {}

  /**
   * Called once during the INITIALIZED → WARMED_UP transition.
   *
   * Use this to load historical candles, seed indicator accumulators, and prepare
   * the strategy for live signal generation. ctx.historical.getCandles() is available.
   *
   * Call this.setWarmupProgress(0.0 to 1.0) to report warmup progress.
   * Throwing here marks the plugin as ERROR.
   */
  protected async onWarmup(_ctx: SdkWarmupContext): Promise<void> {}

  /**
   * Called once when the platform is shutting down or unloading this plugin.
   *
   * Use this to flush internal state and release resources. The platform waits
   * up to 5 seconds for this to complete before force-terminating.
   */
  protected async onShutdown(): Promise<void> {}

  // ---------------------------------------------------------------------------
  // Market event hooks — override the ones your strategy observes
  // ---------------------------------------------------------------------------

  /**
   * Called on every closed or real-time candle from the configured timeframe.
   *
   * Use this to update internal state derived from OHLCV data. The platform
   * calls generateSignal() after onCandle() completes — so state updated here
   * is visible to generateSignal() in the same cycle.
   *
   * Check candle.isClosed before acting to avoid processing incomplete candles.
   */
  protected async onCandle(_candle: SdkCandle): Promise<void> {}

  /**
   * Called on every best-bid/best-ask tick update.
   *
   * High-frequency hook — keep this fast (< 1 ms). Long-running tick handlers
   * delay subsequent ticks for all strategies on the same symbol.
   */
  protected async onTick(_tick: SdkTick): Promise<void> {}

  /**
   * Called on every public trade from the exchange trade feed.
   */
  protected async onTrade(_trade: SdkTrade): Promise<void> {}

  // ---------------------------------------------------------------------------
  // Execution event hooks — override if your strategy tracks fills
  // ---------------------------------------------------------------------------

  /**
   * Called when an order originated from this strategy's signal is filled
   * (fully or partially). Use this to update internal position tracking.
   *
   * Note: strategies NEVER submit orders — you cannot cancel or modify them here.
   * This hook is for observing fills only.
   */
  protected async onOrderFilled(_report: SdkExecutionReport): Promise<void> {}

  /**
   * Called when an order originated from this strategy's signal is rejected
   * or cancelled by the exchange. Use this to apply backoff or suppress
   * further signals on the same symbol temporarily.
   */
  protected async onOrderRejected(_report: SdkExecutionReport): Promise<void> {}

  /**
   * Called when a position update arrives (opened, size changed, or closed).
   * Use this to synchronize internal position state with the platform's view.
   */
  protected async onPositionUpdate(_position: SdkOpenPosition): Promise<void> {}

  // ---------------------------------------------------------------------------
  // Signal generation — MUST be implemented by every strategy
  // ---------------------------------------------------------------------------

  /**
   * The core signal-generation hook. Called by the platform after each closed candle
   * (or on any other configured trigger). Return a SdkSignal to request a trade,
   * or null to hold.
   *
   * Constraints:
   *   - MUST complete within maxRuntimeMs (default 5000 ms); slower calls are timed out
   *   - MUST NOT perform I/O (use ctx.historical only during onWarmup())
   *   - MUST return null when market conditions are unclear (not a random guess)
   *   - signal.confidence MUST be in [0.0, 1.0]
   *
   * The risk engine evaluates every signal. A returned signal is NOT guaranteed
   * to become an order — the risk engine may reject it.
   */
  protected abstract generateSignal(ctx: SdkStrategyContext): Promise<SdkSignal | null>;

  // ---------------------------------------------------------------------------
  // Protected helpers — available to strategy implementations
  // ---------------------------------------------------------------------------

  /**
   * Increments the skipped-events counter and returns early when called.
   *
   * Use this inside onCandle() / generateSignal() when market conditions don't
   * warrant processing (e.g. insufficient data, wrong timeframe).
   * The counter is visible in the platform's strategy health report.
   */
  protected skip(): void {
    this._skippedEvents++;
  }

  /**
   * Emits a structured log message from the strategy.
   *
   * Messages are collected by the platform and emitted via the standard
   * logger with the strategy ID as context. Do not use console.log() —
   * it bypasses the platform's logging infrastructure.
   *
   * Log level is always 'debug' during production; use sparingly in hot paths.
   */
  protected log(message: string): void {
    this._logBuffer.push(message);
  }

  /**
   * Reports warmup progress as a fraction in [0.0, 1.0].
   *
   * Call this during onWarmup() to report how far through historical loading
   * the strategy is. The platform surfaces this in health checks.
   * Values are clamped to [0.0, 1.0].
   */
  protected setWarmupProgress(progress: number): void {
    this._warmupProgress = Math.max(0, Math.min(1, progress));
  }
}
