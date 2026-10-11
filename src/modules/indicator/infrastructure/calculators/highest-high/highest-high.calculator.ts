import { RedisHashService } from '@infrastructure/redis/hash/redis-hash.service';
import { IndicatorType } from '../../../domain/enums/indicator-type.enum';
import { Timeframe } from '../../../domain/enums/timeframe.enum';
import { Candle } from '../../../domain/models/candle.model';
import { HighestHighValue, IndicatorValue } from '../../../domain/models/indicator-value.model';
import { INDICATOR_HASH_KEYS } from '../../cache/indicator-hash-keys';
import { BaseIndicatorCalculator } from '../base/base-indicator-calculator';
import { IndicatorCalculatorConfig } from '../../../interfaces/indicator-calculator.interface';

interface HighestHighState {
  highBuffer: number[];
  head: number;
  filled: boolean;
}

export function createHighestHighConfig(
  symbol: string,
  timeframe: Timeframe,
  period: number,
): IndicatorCalculatorConfig {
  return { type: IndicatorType.HIGHEST_HIGH, symbol, timeframe, period, params: {} };
}

/**
 * Highest High (HH)
 *
 * Formula: HH = max(high_i) for i in rolling window of length period
 * Inputs: high
 * Outputs: HighestHighValue.value — rolling maximum high
 * Warmup: period candles
 * Complexity: O(N) scan per computeValue call (N = period); use deque for O(1) if period is large
 * Failure modes: buffer initialized to 0; warmup guard ensures partial windows are never returned
 */
export class HighestHighCalculator extends BaseIndicatorCalculator {
  private _s: HighestHighState;

  constructor(
    config: IndicatorCalculatorConfig,
    private readonly hashService: RedisHashService,
  ) {
    super(config);
    this._s = HighestHighCalculator.createEmptyState(config.period);
  }

  protected resetState(): void {
    this._s = HighestHighCalculator.createEmptyState(this.config.period);
  }

  protected applyCandle(candle: Candle): void {
    const { head } = this._s;
    const period = this.config.period;

    this._s.highBuffer[head] = candle.high;
    this._s.head = (head + 1) % period;

    if (!this._s.filled && this._s.head === 0) {
      this._s.filled = true;
    }
  }

  protected computeValue(): IndicatorValue {
    let highest = -Infinity;
    for (let i = 0; i < this.config.period; i++) {
      if (this._s.highBuffer[i] > highest) highest = this._s.highBuffer[i];
    }
    return { type: IndicatorType.HIGHEST_HIGH, value: highest } as HighestHighValue;
  }

  protected async writeToRedis(value: IndicatorValue): Promise<void> {
    const field = this.id.replace(`${IndicatorType.HIGHEST_HIGH}:`, '');
    await this.hashService.set(
      INDICATOR_HASH_KEYS[IndicatorType.HIGHEST_HIGH],
      field,
      (value as HighestHighValue).value,
    );
  }

  private static createEmptyState(period: number): HighestHighState {
    return {
      highBuffer: new Array(period).fill(0),
      head: 0,
      filled: false,
    };
  }
}
