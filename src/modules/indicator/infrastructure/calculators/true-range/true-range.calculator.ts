import { RedisHashService } from '@infrastructure/redis/hash/redis-hash.service';
import { IndicatorType } from '../../../domain/enums/indicator-type.enum';
import { Timeframe } from '../../../domain/enums/timeframe.enum';
import { Candle } from '../../../domain/models/candle.model';
import { TrueRangeValue, IndicatorValue } from '../../../domain/models/indicator-value.model';
import { INDICATOR_HASH_KEYS } from '../../cache/indicator-hash-keys';
import { BaseIndicatorCalculator } from '../base/base-indicator-calculator';
import { IndicatorCalculatorConfig } from '../../../interfaces/indicator-calculator.interface';

interface TrueRangeState {
  previousClose: number;
  currentTr: number;
}

export function createTrueRangeConfig(
  symbol: string,
  timeframe: Timeframe,
): IndicatorCalculatorConfig {
  return { type: IndicatorType.TRUE_RANGE, symbol, timeframe, period: 2, params: {} };
}

/**
 * True Range (TR)
 *
 * Formula: TR = max(high - low, |high - prevClose|, |low - prevClose|)
 *          First candle (no prevClose): TR = high - low
 * Inputs: high, low, close
 * Outputs: TrueRangeValue.value — raw true range for the most recent candle
 * Warmup: 2 candles (first stores prevClose, second produces TR)
 * Complexity: O(1) per update
 * Failure modes: always non-negative; falls back to high-low when no prevClose available
 */
export class TrueRangeCalculator extends BaseIndicatorCalculator {
  private _s: TrueRangeState;

  constructor(
    config: IndicatorCalculatorConfig,
    private readonly hashService: RedisHashService,
  ) {
    super(config);
    this._s = TrueRangeCalculator.createEmptyState();
  }

  getWarmupRequired(): number {
    return 2;
  }

  protected resetState(): void {
    this._s = TrueRangeCalculator.createEmptyState();
  }

  protected applyCandle(candle: Candle): void {
    if (this._s.previousClose === 0) {
      this._s.previousClose = candle.close;
      return;
    }
    this._s.currentTr = Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - this._s.previousClose),
      Math.abs(candle.low - this._s.previousClose),
    );
    this._s.previousClose = candle.close;
  }

  protected computeValue(): IndicatorValue {
    return { type: IndicatorType.TRUE_RANGE, value: this._s.currentTr } as TrueRangeValue;
  }

  protected async writeToRedis(value: IndicatorValue): Promise<void> {
    const field = this.id.replace(`${IndicatorType.TRUE_RANGE}:`, '');
    await this.hashService.set(
      INDICATOR_HASH_KEYS[IndicatorType.TRUE_RANGE],
      field,
      (value as TrueRangeValue).value,
    );
  }

  private static createEmptyState(): TrueRangeState {
    return {
      previousClose: 0,
      currentTr: 0,
    };
  }
}
