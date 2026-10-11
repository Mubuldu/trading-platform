import { ok } from '@common/result';
import { Result } from '@common/result';
import { MarketTick, Trade } from '@modules/exchange/models/market.models';
import { ExecutionReport } from '@modules/exchange/models/trading.models';
import { Position } from '@modules/exchange/models/account.models';
import { Candle } from '@modules/indicator/domain/models/candle.model';
import { StrategyState } from '../domain/enums/strategy-state.enum';
import { StrategyConfigValidationError } from '../domain/errors/strategy.errors';
import {
  IStrategy,
  StrategyContext,
  StrategyHealth,
  StrategyMetrics,
  StrategyPluginConfig,
} from '../interfaces/strategy.interface';
import { Signal } from '../interfaces/signal.interface';

/**
 * BaseStrategy is the abstract foundation every strategy plugin must extend.
 *
 * It handles all lifecycle bookkeeping — state transitions, metrics tracking,
 * and error isolation — so subclasses only override the hooks they care about.
 * All hooks default to no-ops; a strategy that only generates signals on candles
 * need only override doOnCandle() and doGenerateSignal().
 *
 * Error contract: errors thrown inside any do* hook are caught here, recorded
 * in metrics, and do NOT propagate. The strategy transitions to ERROR state.
 * The scheduler sees the ERROR state and can decide whether to disable the
 * strategy or attempt recovery.
 */
export abstract class BaseStrategy implements IStrategy {
  protected _state: StrategyState = StrategyState.IDLE;
  protected _config: StrategyPluginConfig;

  private _enabled = false;
  private _signalsGenerated = 0;
  private _errorsCount = 0;
  private _skippedEvents = 0;
  private _totalRuntimeMs = 0;
  private _hookCallCount = 0;
  private _lastSignalAt: number | null = null;
  private _lastErrorAt: number | null = null;
  private _lastError: string | null = null;
  private _warmupProgress = 0;

  protected constructor(initialConfig: StrategyPluginConfig) {
    this._config = initialConfig;
  }

  get id(): string {
    return this._config.strategyId;
  }

  get config(): StrategyPluginConfig {
    return this._config;
  }

  get state(): StrategyState {
    return this._state;
  }

  get version(): string {
    return this._config.version;
  }

  async initialize(): Promise<void> {
    this._state = StrategyState.LOADING;
    try {
      await this.onInitialize();
      this._state = StrategyState.IDLE;
    } catch (e) {
      this.recordError('initialize', e);
      throw e;
    }
  }

  async loadConfiguration(config: StrategyPluginConfig): Promise<void> {
    this._state = StrategyState.VALIDATING;
    this._config = config;
    try {
      await this.onConfigurationLoaded(config);
      if (this._state === StrategyState.VALIDATING) {
        this._state = StrategyState.IDLE;
      }
    } catch (e) {
      this.recordError('loadConfiguration', e);
      throw e;
    }
  }

  validateConfiguration(config: StrategyPluginConfig): Result<void, StrategyConfigValidationError> {
    return this.doValidateConfiguration(config);
  }

  async warmup(context: StrategyContext): Promise<void> {
    this._state = StrategyState.WARMING_UP;
    this._warmupProgress = 0;
    try {
      await this.onWarmup(context);
      this._warmupProgress = 1;
      this._state = StrategyState.RUNNING;
    } catch (e) {
      this.recordError('warmup', e);
      throw e;
    }
  }

  async onTick(tick: MarketTick): Promise<void> {
    await this.runHook('onTick', () => this.doOnTick(tick));
  }

  async onTrade(trade: Trade): Promise<void> {
    await this.runHook('onTrade', () => this.doOnTrade(trade));
  }

  async onCandle(candle: Candle): Promise<void> {
    await this.runHook('onCandle', () => this.doOnCandle(candle));
  }

  async generateSignal(context: StrategyContext): Promise<Signal | null> {
    const start = Date.now();
    try {
      const signal = await this.doGenerateSignal(context);
      this._hookCallCount++;
      this._totalRuntimeMs += Date.now() - start;
      if (signal !== null) {
        this._signalsGenerated++;
        this._lastSignalAt = Date.now();
      }
      return signal;
    } catch (e) {
      this._hookCallCount++;
      this._totalRuntimeMs += Date.now() - start;
      this.recordError('generateSignal', e);
      return null;
    }
  }

  async onOrderFilled(report: ExecutionReport): Promise<void> {
    await this.runHook('onOrderFilled', () => this.doOnOrderFilled(report));
  }

  async onOrderRejected(report: ExecutionReport): Promise<void> {
    await this.runHook('onOrderRejected', () => this.doOnOrderRejected(report));
  }

  async onPositionOpened(position: Position): Promise<void> {
    await this.runHook('onPositionOpened', () => this.doOnPositionOpened(position));
  }

  async onPositionClosed(position: Position): Promise<void> {
    await this.runHook('onPositionClosed', () => this.doOnPositionClosed(position));
  }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
  }

  async shutdown(): Promise<void> {
    try {
      await this.onShutdown();
    } finally {
      this._state = StrategyState.SHUTDOWN;
      this._enabled = false;
    }
  }

  getHealth(): StrategyHealth {
    return {
      id: this.id,
      name: this._config.name,
      version: this._config.version,
      state: this._state,
      enabled: this._enabled,
      metrics: this.getMetrics(),
      lastSignalAt: this._lastSignalAt,
      lastErrorAt: this._lastErrorAt,
      lastError: this._lastError,
    };
  }

  getMetrics(): StrategyMetrics {
    return {
      signalsGenerated: this._signalsGenerated,
      averageRuntimeMs: this._hookCallCount > 0 ? this._totalRuntimeMs / this._hookCallCount : 0,
      errorsCount: this._errorsCount,
      skippedEvents: this._skippedEvents,
      warmupProgress: this._warmupProgress,
    };
  }

  protected skip(): void {
    this._skippedEvents++;
  }

  protected setWarmupProgress(progress: number): void {
    this._warmupProgress = Math.max(0, Math.min(1, progress));
  }

  protected async onInitialize(): Promise<void> {}
  protected async onConfigurationLoaded(_config: StrategyPluginConfig): Promise<void> {}
  protected doValidateConfiguration(
    _config: StrategyPluginConfig,
  ): Result<void, StrategyConfigValidationError> {
    return ok(undefined);
  }
  protected async onWarmup(_context: StrategyContext): Promise<void> {}

  protected async doOnTick(_tick: MarketTick): Promise<void> {}
  protected async doOnTrade(_trade: Trade): Promise<void> {}
  protected async doOnCandle(_candle: Candle): Promise<void> {}
  protected async doGenerateSignal(_context: StrategyContext): Promise<Signal | null> {
    return null;
  }
  protected async doOnOrderFilled(_report: ExecutionReport): Promise<void> {}
  protected async doOnOrderRejected(_report: ExecutionReport): Promise<void> {}
  protected async doOnPositionOpened(_position: Position): Promise<void> {}
  protected async doOnPositionClosed(_position: Position): Promise<void> {}
  protected async onShutdown(): Promise<void> {}

  private async runHook(name: string, fn: () => Promise<void>): Promise<void> {
    const start = Date.now();
    try {
      await fn();
      this._hookCallCount++;
      this._totalRuntimeMs += Date.now() - start;
    } catch (e) {
      this._hookCallCount++;
      this._totalRuntimeMs += Date.now() - start;
      this.recordError(name, e);
    }
  }

  private recordError(hook: string, e: unknown): void {
    this._errorsCount++;
    this._lastErrorAt = Date.now();
    this._lastError = `${hook}: ${e instanceof Error ? e.message : String(e)}`;
    this._state = StrategyState.ERROR;
  }
}
