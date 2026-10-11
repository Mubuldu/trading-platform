import { SdkStrategy } from '../base/sdk-strategy';
import { SdkStrategyContext } from '../context/sdk-strategy-context';
import { SdkInitContext, SdkWarmupContext } from '../context/sdk-init-context';
import { SdkCandle } from '../market/candle.types';
import { SdkTick, SdkTrade } from '../market/tick.types';
import { SdkExecutionReport } from '../market/execution.types';
import { SdkOpenPosition } from '../market/position.types';
import { SdkSignal } from '../market/signal.types';

/**
 * SandboxExecutionResult carries the outcome of one sandboxed hook call.
 *
 * success: true  → the hook completed within budget; logs and signals are valid
 * success: false → the hook threw, timed out, or exceeded a resource limit;
 *                  error is the captured exception; caller decides how to respond
 */
export interface SandboxExecutionResult<T> {
  readonly success: boolean;
  readonly value: T | null;
  readonly error: Error | null;
  readonly durationMs: number;
  readonly logs: readonly string[];
}

/**
 * PluginSandboxConfig controls resource limits for a single strategy instance.
 *
 * maxRuntimeMs      — hook calls that take longer than this are cancelled and reported as failure
 * maxEventsPerSecond— hooks dispatched above this rate are skipped (rate window = 1 second)
 *
 * Note on isolation depth:
 *   This implementation provides Promise-level isolation via try/catch + timeout racing.
 *   It does NOT provide OS-level process isolation. One strategy that enters an infinite
 *   synchronous loop (while(true){}) blocks the Node.js event loop for ALL strategies
 *   until the timeout fires — but the timeout only fires on the NEXT event loop tick.
 *
 *   Full Worker-thread isolation (true process-level sandbox) is the recommended
 *   upgrade path for production deployments with untrusted third-party code.
 *   See sdk/strategy-sdk/docs/security-model.md for the upgrade path.
 *
 *   For trusted in-house strategies, Promise-level isolation is sufficient.
 */
export interface PluginSandboxConfig {
  readonly strategyId: string;
  readonly maxRuntimeMs: number;
  readonly maxEventsPerSecond: number;
}

/**
 * PluginSandbox wraps a single SdkStrategy instance and enforces:
 *
 *   1. Error isolation — any exception from any hook is caught; it NEVER propagates
 *      to the caller. The caller receives a SandboxExecutionResult with success=false.
 *
 *   2. Timeout enforcement — each hook races against a Promise.race with a timer.
 *      Hooks that exceed maxRuntimeMs are reported as failures.
 *
 *   3. Rate limiting — hooks dispatched above maxEventsPerSecond are skipped.
 *      The skipped-events counter is exposed for health reporting.
 *
 *   4. Log capture — messages emitted via strategy.log() are drained after each call
 *      and surfaced in SandboxExecutionResult.logs.
 *
 * One PluginSandbox is created per strategy instance. The platform's PluginLifecycleManager
 * owns the sandbox and routes all event dispatches through it.
 *
 * Thread safety: PluginSandbox is NOT thread-safe. All calls must come from the
 * same event loop (Node.js single-thread model guarantees this in normal usage).
 */
export class PluginSandbox {
  private readonly config: PluginSandboxConfig;
  private readonly strategy: SdkStrategy;

  private _skippedByRateLimit = 0;
  private _rateWindow: { count: number; windowStart: number } = { count: 0, windowStart: 0 };

  constructor(strategy: SdkStrategy, config: PluginSandboxConfig) {
    this.strategy = strategy;
    this.config = config;
  }

  async initialize(ctx: SdkInitContext): Promise<SandboxExecutionResult<void>> {
    return this.run(() => this.strategy._initialize(ctx));
  }

  async warmup(ctx: SdkWarmupContext): Promise<SandboxExecutionResult<void>> {
    // Warmup may be slow (historical data I/O) — use 10× the normal budget
    return this.run(() => this.strategy._warmup(ctx), this.config.maxRuntimeMs * 10);
  }

  async onCandle(candle: SdkCandle): Promise<SandboxExecutionResult<void>> {
    if (!this.checkRateLimit()) return this.skippedResult();
    return this.run(() => this.strategy._onCandle(candle));
  }

  async onTick(tick: SdkTick): Promise<SandboxExecutionResult<void>> {
    if (!this.checkRateLimit()) return this.skippedResult();
    return this.run(() => this.strategy._onTick(tick));
  }

  async onTrade(trade: SdkTrade): Promise<SandboxExecutionResult<void>> {
    if (!this.checkRateLimit()) return this.skippedResult();
    return this.run(() => this.strategy._onTrade(trade));
  }

  async onOrderFilled(report: SdkExecutionReport): Promise<SandboxExecutionResult<void>> {
    return this.run(() => this.strategy._onOrderFilled(report));
  }

  async onOrderRejected(report: SdkExecutionReport): Promise<SandboxExecutionResult<void>> {
    return this.run(() => this.strategy._onOrderRejected(report));
  }

  async onPositionUpdate(position: SdkOpenPosition): Promise<SandboxExecutionResult<void>> {
    return this.run(() => this.strategy._onPositionUpdate(position));
  }

  async generateSignal(ctx: SdkStrategyContext): Promise<SandboxExecutionResult<SdkSignal | null>> {
    if (!this.checkRateLimit()) return this.skippedResult<SdkSignal | null>();
    return this.run(() => this.strategy._generateSignal(ctx));
  }

  async shutdown(): Promise<SandboxExecutionResult<void>> {
    // Shutdown gets a fixed 5-second budget regardless of maxRuntimeMs
    return this.run(() => this.strategy._shutdown(), 5_000);
  }

  getWarmupProgress(): number {
    return this.strategy._getWarmupProgress();
  }

  getSkippedByRateLimit(): number {
    return this._skippedByRateLimit;
  }

  // ---------------------------------------------------------------------------
  // Private implementation
  // ---------------------------------------------------------------------------

  private async run<T>(
    fn: () => Promise<T>,
    maxMs?: number,
  ): Promise<SandboxExecutionResult<T>> {
    const budget = maxMs ?? this.config.maxRuntimeMs;
    const start = Date.now();

    try {
      const result = await this.raceTimeout(fn, budget);
      const logs = this.strategy._drainLogs();
      return {
        success: true,
        value: result,
        error: null,
        durationMs: Date.now() - start,
        logs,
      };
    } catch (e) {
      const logs = this.strategy._drainLogs();
      return {
        success: false,
        value: null,
        error: e instanceof Error ? e : new Error(String(e)),
        durationMs: Date.now() - start,
        logs,
      };
    }
  }

  /**
   * Races fn() against a timeout. Rejects with a timeout error if fn() takes too long.
   *
   * Important: even when the timeout fires, fn() continues running in the background
   * until Node.js GC collects it. This is unavoidable without Worker threads. The
   * strategy's state may still be modified by the slow hook after this method returns.
   * Worker-thread isolation eliminates this entirely — see security-model.md.
   */
  private raceTimeout<T>(fn: () => Promise<T>, maxMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `Strategy "${this.config.strategyId}" hook timed out after ${maxMs} ms. ` +
            `Increase maxRuntimeMs in the plugin manifest's riskLimits, or optimize the hook.`,
          ),
        );
      }, maxMs);

      fn().then(
        (value) => { clearTimeout(timer); resolve(value); },
        (err)   => { clearTimeout(timer); reject(err); },
      );
    });
  }

  private checkRateLimit(): boolean {
    const now = Date.now();
    const window = this._rateWindow;

    if (now - window.windowStart >= 1_000) {
      this._rateWindow = { count: 1, windowStart: now };
      return true;
    }

    if (window.count >= this.config.maxEventsPerSecond) {
      this._skippedByRateLimit++;
      return false;
    }

    window.count++;
    return true;
  }

  private skippedResult<T = void>(): SandboxExecutionResult<T> {
    return {
      success: true,   // skipping is not a failure
      value: null,
      error: null,
      durationMs: 0,
      logs: [],
    };
  }
}
