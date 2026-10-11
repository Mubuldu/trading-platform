import { Result, ok, err } from '@common/result';
import { IndicatorState } from '../../../domain/enums/indicator-state.enum';
import { Candle } from '../../../domain/models/candle.model';
import { IndicatorValue } from '../../../domain/models/indicator-value.model';
import {
  IndicatorInvalidCandleError,
  IndicatorNotWarmedUpError,
} from '../../../domain/errors/indicator.errors';
import {
  IIndicatorCalculator,
  IndicatorCalculatorConfig,
  IndicatorHealth,
} from '../../../interfaces/indicator-calculator.interface';

export abstract class BaseIndicatorCalculator implements IIndicatorCalculator {
  readonly id: string;
  protected _state: IndicatorState = IndicatorState.IDLE;
  protected _candlesProcessed = 0;
  protected _lastCalculatedAt: number | null = null;
  protected _lastPublishedAt: number | null = null;
  protected _lastError: string | null = null;
  protected _latestValue: IndicatorValue | null = null;
  private _lastPublishedJson: string | null = null;

  protected constructor(readonly config: IndicatorCalculatorConfig) {
    this.id = BaseIndicatorCalculator.buildId(config);
  }

  static buildId(config: IndicatorCalculatorConfig): string {
    const extra = Object.entries(config.params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => String(v))
      .join(':');
    const base = `${config.type}:${config.symbol}:${config.timeframe}:${config.period}`;
    return extra ? `${base}:${extra}` : base;
  }

  get state(): IndicatorState {
    return this._state;
  }

  initialize(): void {
    this.resetState();
    this._state = IndicatorState.IDLE;
  }

  warmup(candles: Candle[]): void {
    this._state = IndicatorState.WARMING_UP;
    this._candlesProcessed = 0;
    this.resetState();

    for (const candle of candles) {
      this.applyCandle(candle);
      this._candlesProcessed++;
    }

    if (this._candlesProcessed >= this.getWarmupRequired()) {
      this._state = IndicatorState.READY;
    }
  }

  update(candle: Candle): Result<void, IndicatorInvalidCandleError> {
    // Advance IDLE → WARMING_UP on first update so that the backtest engine,
    // which calls update() directly (without a prior warmup() call), can still
    // progress to READY once enough candles have been processed.
    // The live pipeline calls warmup() first, which already sets WARMING_UP.
    if (this._state === IndicatorState.IDLE) {
      this._state = IndicatorState.WARMING_UP;
    }
    this.applyCandle(candle);
    this._candlesProcessed++;
    if (
      this._state === IndicatorState.WARMING_UP &&
      this._candlesProcessed >= this.getWarmupRequired()
    ) {
      this._state = IndicatorState.READY;
    }
    this._lastCalculatedAt = Date.now();
    return ok(undefined);
  }

  calculate(): Result<IndicatorValue, IndicatorNotWarmedUpError> {
    if (!this.isWarmedUp()) {
      return err(
        new IndicatorNotWarmedUpError(this.id, this.getWarmupRequired(), this._candlesProcessed),
      );
    }
    const value = this.computeValue();
    this._latestValue = value;
    this._lastCalculatedAt = Date.now();
    return ok(value);
  }

  async publish(): Promise<void> {
    if (!this.isWarmedUp()) return;
    const result = this.calculate();
    if (result.isErr()) return;
    const json = JSON.stringify(result.value);
    if (json === this._lastPublishedJson) return;
    await this.writeToRedis(result.value);
    this._lastPublishedJson = json;
    this._lastPublishedAt = Date.now();
  }

  reset(): void {
    this._state = IndicatorState.IDLE;
    this._candlesProcessed = 0;
    this._lastCalculatedAt = null;
    this._lastPublishedAt = null;
    this._lastError = null;
    this._latestValue = null;
    this._lastPublishedJson = null;
    this.resetState();
  }

  async shutdown(): Promise<void> {
    this._state = IndicatorState.SHUTDOWN;
  }

  isWarmedUp(): boolean {
    return this._state === IndicatorState.READY;
  }

  getWarmupRequired(): number {
    return this.config.period;
  }

  getCandlesProcessed(): number {
    return this._candlesProcessed;
  }

  getHealth(): IndicatorHealth {
    return {
      id: this.id,
      type: this.config.type,
      symbol: this.config.symbol,
      timeframe: this.config.timeframe,
      state: this._state,
      candlesProcessed: this._candlesProcessed,
      warmupRequired: this.getWarmupRequired(),
      lastCalculatedAt: this._lastCalculatedAt,
      lastPublishedAt: this._lastPublishedAt,
      lastError: this._lastError,
      latestValue: this._latestValue,
      historyLength: this._candlesProcessed,
    };
  }

  protected abstract applyCandle(candle: Candle): void;
  protected abstract computeValue(): IndicatorValue;
  protected abstract writeToRedis(value: IndicatorValue): Promise<void>;
  protected abstract resetState(): void;
}
