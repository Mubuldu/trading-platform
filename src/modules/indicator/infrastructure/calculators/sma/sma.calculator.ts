import { RedisHashService } from '@infrastructure/redis/hash/redis-hash.service';
import { IndicatorType } from '../../../domain/enums/indicator-type.enum';
import { Timeframe } from '../../../domain/enums/timeframe.enum';
import { Candle } from '../../../domain/models/candle.model';
import { SmaValue, IndicatorValue } from '../../../domain/models/indicator-value.model';
import { INDICATOR_HASH_KEYS } from '../../cache/indicator-hash-keys';
import { BaseIndicatorCalculator } from '../base/base-indicator-calculator';
import { IndicatorCalculatorConfig } from '../../../interfaces/indicator-calculator.interface';

interface SmaState {
  closeBuffer: number[];
  head: number;
  sum: number;
  filled: boolean;
}

export function createSmaConfig(
  symbol: string,
  timeframe: Timeframe,
  period: number,
): IndicatorCalculatorConfig {
  return { type: IndicatorType.SMA, symbol, timeframe, period, params: {} };
}

/**
 * Simple Moving Average (SMA)
 *
 * Formula: SMA = sum(close_i) / period for i in rolling window
 * Inputs: close price
 * Outputs: SmaValue.value
 * Warmup: period candles
 * Complexity: O(1) per update with rolling sum
 * Failure modes: returns 0 if buffer not filled (warmup guard prevents this)
 */
export class SmaCalculator extends BaseIndicatorCalculator {
  private _s: SmaState;

  constructor(
    config: IndicatorCalculatorConfig,
    private readonly hashService: RedisHashService,
  ) {
    super(config);
    this._s = SmaCalculator.createEmptyState(config.period);
  }

  protected resetState(): void {
    this._s = SmaCalculator.createEmptyState(this.config.period);
  }

  protected applyCandle(candle: Candle): void {
    const { head, closeBuffer } = this._s;
    const period = this.config.period;
    const evicting = closeBuffer[head];

    closeBuffer[head] = candle.close;
    this._s.head = (head + 1) % period;
    this._s.sum = this._s.sum - evicting + candle.close;

    if (!this._s.filled && this._s.head === 0) {
      this._s.filled = true;
    }
  }

  protected computeValue(): IndicatorValue {
    return {
      type: IndicatorType.SMA,
      value: this._s.sum / this.config.period,
    } as SmaValue;
  }

  protected async writeToRedis(value: IndicatorValue): Promise<void> {
    const field = this.id.replace(`${IndicatorType.SMA}:`, '');
    await this.hashService.set(
      INDICATOR_HASH_KEYS[IndicatorType.SMA],
      field,
      (value as SmaValue).value,
    );
  }

  private static createEmptyState(period: number): SmaState {
    return {
      closeBuffer: new Array(period).fill(0),
      head: 0,
      sum: 0,
      filled: false,
    };
  }
}
