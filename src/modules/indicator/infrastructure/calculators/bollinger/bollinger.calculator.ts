import { RedisHashService } from '@infrastructure/redis/hash/redis-hash.service';
import { IndicatorType } from '../../../domain/enums/indicator-type.enum';
import { Timeframe } from '../../../domain/enums/timeframe.enum';
import { Candle } from '../../../domain/models/candle.model';
import { BollingerValue, IndicatorValue } from '../../../domain/models/indicator-value.model';
import { INDICATOR_HASH_KEYS } from '../../cache/indicator-hash-keys';
import { BaseIndicatorCalculator } from '../base/base-indicator-calculator';
import { IndicatorCalculatorConfig } from '../../../interfaces/indicator-calculator.interface';

interface BollingerState {
  closeBuffer: number[];
  head: number;
  sum: number;
  sumSq: number;
  filled: boolean;
}

export function createBollingerConfig(
  symbol: string,
  timeframe: Timeframe,
  period: number,
  stdDevMultiplier = 2,
): IndicatorCalculatorConfig {
  return {
    type: IndicatorType.BOLLINGER,
    symbol,
    timeframe,
    period,
    params: { stdDevMultiplier },
  };
}

export class BollingerCalculator extends BaseIndicatorCalculator {
  private _s: BollingerState;
  private readonly k: number;

  constructor(
    config: IndicatorCalculatorConfig,
    private readonly hashService: RedisHashService,
  ) {
    super(config);
    this.k = config.params.stdDevMultiplier ?? 2;
    this._s = BollingerCalculator.createEmptyState(config.period);
  }

  protected resetState(): void {
    this._s = BollingerCalculator.createEmptyState(this.config.period);
  }

  protected applyCandle(candle: Candle): void {
    const { head, closeBuffer, period } = { ...this._s, period: this.config.period };
    const evicting = closeBuffer[head];

    closeBuffer[head] = candle.close;
    this._s.head = (head + 1) % period;

    this._s.sum = this._s.sum - evicting + candle.close;
    this._s.sumSq = this._s.sumSq - evicting * evicting + candle.close * candle.close;

    if (!this._s.filled && this._s.head === 0) {
      this._s.filled = true;
    }
  }

  protected computeValue(): IndicatorValue {
    const period = this.config.period;
    const mean = this._s.sum / period;
    const variance = this._s.sumSq / period - mean * mean;
    const stdDev = Math.sqrt(Math.max(0, variance));

    const upper = mean + this.k * stdDev;
    const lower = mean - this.k * stdDev;
    const bandwidth = mean !== 0 ? ((upper - lower) / mean) * 100 : 0;
    const percentB =
      upper !== lower
        ? (this._s.closeBuffer[(this._s.head - 1 + period) % period] - lower) / (upper - lower)
        : 0.5;

    return {
      type: IndicatorType.BOLLINGER,
      upper,
      middle: mean,
      lower,
      bandwidth,
      percentB,
    } as BollingerValue;
  }

  protected async writeToRedis(value: IndicatorValue): Promise<void> {
    const field = this.id.replace(`${IndicatorType.BOLLINGER}:`, '');
    const v = value as BollingerValue;
    await this.hashService.set(
      INDICATOR_HASH_KEYS[IndicatorType.BOLLINGER],
      field,
      JSON.stringify({
        upper: v.upper,
        middle: v.middle,
        lower: v.lower,
        bandwidth: v.bandwidth,
        percentB: v.percentB,
      }),
    );
  }

  private static createEmptyState(period: number): BollingerState {
    return {
      closeBuffer: new Array(period).fill(0),
      head: 0,
      sum: 0,
      sumSq: 0,
      filled: false,
    };
  }
}
