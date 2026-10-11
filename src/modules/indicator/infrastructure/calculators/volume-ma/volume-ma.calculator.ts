import { RedisHashService } from '@infrastructure/redis/hash/redis-hash.service';
import { IndicatorType } from '../../../domain/enums/indicator-type.enum';
import { Timeframe } from '../../../domain/enums/timeframe.enum';
import { Candle } from '../../../domain/models/candle.model';
import { VolumeMaValue, IndicatorValue } from '../../../domain/models/indicator-value.model';
import { INDICATOR_HASH_KEYS } from '../../cache/indicator-hash-keys';
import { BaseIndicatorCalculator } from '../base/base-indicator-calculator';
import { IndicatorCalculatorConfig } from '../../../interfaces/indicator-calculator.interface';

interface VolumeMaState {
  volumeBuffer: number[];
  head: number;
  sum: number;
  filled: boolean;
}

export function createVolumeMaConfig(
  symbol: string,
  timeframe: Timeframe,
  period: number,
): IndicatorCalculatorConfig {
  return { type: IndicatorType.VOLUME_MA, symbol, timeframe, period, params: {} };
}

/**
 * Volume Moving Average (VMA)
 *
 * Formula: VMA = sum(volume_i) / period for i in rolling window
 * Inputs: volume
 * Outputs: VolumeMaValue.value — rolling average volume
 * Warmup: period candles
 * Complexity: O(1) per update with rolling sum
 * Failure modes: buffer initialized to 0, so early values include zero-padded slots;
 *                warmup guard ensures this is never returned to callers
 */
export class VolumeMaCalculator extends BaseIndicatorCalculator {
  private _s: VolumeMaState;

  constructor(
    config: IndicatorCalculatorConfig,
    private readonly hashService: RedisHashService,
  ) {
    super(config);
    this._s = VolumeMaCalculator.createEmptyState(config.period);
  }

  protected resetState(): void {
    this._s = VolumeMaCalculator.createEmptyState(this.config.period);
  }

  protected applyCandle(candle: Candle): void {
    const { head, volumeBuffer } = this._s;
    const period = this.config.period;
    const evicting = volumeBuffer[head];

    volumeBuffer[head] = candle.volume;
    this._s.head = (head + 1) % period;
    this._s.sum = this._s.sum - evicting + candle.volume;

    if (!this._s.filled && this._s.head === 0) {
      this._s.filled = true;
    }
  }

  protected computeValue(): IndicatorValue {
    return {
      type: IndicatorType.VOLUME_MA,
      value: this._s.sum / this.config.period,
    } as VolumeMaValue;
  }

  protected async writeToRedis(value: IndicatorValue): Promise<void> {
    const field = this.id.replace(`${IndicatorType.VOLUME_MA}:`, '');
    await this.hashService.set(
      INDICATOR_HASH_KEYS[IndicatorType.VOLUME_MA],
      field,
      (value as VolumeMaValue).value,
    );
  }

  private static createEmptyState(period: number): VolumeMaState {
    return {
      volumeBuffer: new Array(period).fill(0),
      head: 0,
      sum: 0,
      filled: false,
    };
  }
}
