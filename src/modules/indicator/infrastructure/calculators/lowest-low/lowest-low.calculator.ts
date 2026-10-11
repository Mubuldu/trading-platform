import { RedisHashService } from '@infrastructure/redis/hash/redis-hash.service';
import { IndicatorType } from '../../../domain/enums/indicator-type.enum';
import { Timeframe } from '../../../domain/enums/timeframe.enum';
import { Candle } from '../../../domain/models/candle.model';
import { LowestLowValue, IndicatorValue } from '../../../domain/models/indicator-value.model';
import { INDICATOR_HASH_KEYS } from '../../cache/indicator-hash-keys';
import { BaseIndicatorCalculator } from '../base/base-indicator-calculator';
import { IndicatorCalculatorConfig } from '../../../interfaces/indicator-calculator.interface';

interface LowestLowState {
  lowBuffer: number[];
  head: number;
  filled: boolean;
}

export function createLowestLowConfig(
  symbol: string,
  timeframe: Timeframe,
  period: number,
): IndicatorCalculatorConfig {
  return { type: IndicatorType.LOWEST_LOW, symbol, timeframe, period, params: {} };
}

/**
 * Lowest Low (LL)
 *
 * Formula: LL = min(low_i) for i in rolling window of length period
 * Inputs: low
 * Outputs: LowestLowValue.value — rolling minimum low
 * Warmup: period candles
 * Complexity: O(N) scan per computeValue call (N = period); use deque for O(1) if period is large
 * Failure modes: buffer initialized to 0; warmup guard ensures partial windows are never returned
 */
export class LowestLowCalculator extends BaseIndicatorCalculator {
  private _s: LowestLowState;

  constructor(
    config: IndicatorCalculatorConfig,
    private readonly hashService: RedisHashService,
  ) {
    super(config);
    this._s = LowestLowCalculator.createEmptyState(config.period);
  }

  protected resetState(): void {
    this._s = LowestLowCalculator.createEmptyState(this.config.period);
  }

  protected applyCandle(candle: Candle): void {
    const { head } = this._s;
    const period = this.config.period;

    this._s.lowBuffer[head] = candle.low;
    this._s.head = (head + 1) % period;

    if (!this._s.filled && this._s.head === 0) {
      this._s.filled = true;
    }
  }

  protected computeValue(): IndicatorValue {
    let lowest = Infinity;
    for (let i = 0; i < this.config.period; i++) {
      if (this._s.lowBuffer[i] < lowest) lowest = this._s.lowBuffer[i];
    }
    return { type: IndicatorType.LOWEST_LOW, value: lowest } as LowestLowValue;
  }

  protected async writeToRedis(value: IndicatorValue): Promise<void> {
    const field = this.id.replace(`${IndicatorType.LOWEST_LOW}:`, '');
    await this.hashService.set(
      INDICATOR_HASH_KEYS[IndicatorType.LOWEST_LOW],
      field,
      (value as LowestLowValue).value,
    );
  }

  private static createEmptyState(period: number): LowestLowState {
    return {
      lowBuffer: new Array(period).fill(0),
      head: 0,
      filled: false,
    };
  }
}
