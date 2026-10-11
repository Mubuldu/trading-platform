import { RedisHashService } from '@infrastructure/redis/hash/redis-hash.service';
import { IndicatorType } from '../../../domain/enums/indicator-type.enum';
import { Timeframe } from '../../../domain/enums/timeframe.enum';
import { Candle } from '../../../domain/models/candle.model';
import { DonchianValue, IndicatorValue } from '../../../domain/models/indicator-value.model';
import { INDICATOR_HASH_KEYS } from '../../cache/indicator-hash-keys';
import { BaseIndicatorCalculator } from '../base/base-indicator-calculator';
import { IndicatorCalculatorConfig } from '../../../interfaces/indicator-calculator.interface';

interface DonchianState {
  highBuffer: number[];
  lowBuffer: number[];
  head: number;
  filled: boolean;
}

export function createDonchianConfig(
  symbol: string,
  timeframe: Timeframe,
  period: number,
): IndicatorCalculatorConfig {
  return { type: IndicatorType.DONCHIAN, symbol, timeframe, period, params: {} };
}

export class DonchianCalculator extends BaseIndicatorCalculator {
  private _s: DonchianState;

  constructor(
    config: IndicatorCalculatorConfig,
    private readonly hashService: RedisHashService,
  ) {
    super(config);
    this._s = DonchianCalculator.createEmptyState(config.period);
  }

  protected resetState(): void {
    this._s = DonchianCalculator.createEmptyState(this.config.period);
  }

  protected applyCandle(candle: Candle): void {
    const { head, highBuffer, lowBuffer } = this._s;
    highBuffer[head] = candle.high;
    lowBuffer[head] = candle.low;
    this._s.head = (head + 1) % this.config.period;
    if (!this._s.filled && this._s.head === 0) {
      this._s.filled = true;
    }
  }

  protected computeValue(): IndicatorValue {
    const { highBuffer, lowBuffer } = this._s;
    let upper = -Infinity;
    let lower = Infinity;
    for (let i = 0; i < this.config.period; i++) {
      if (highBuffer[i] > upper) upper = highBuffer[i];
      if (lowBuffer[i] < lower) lower = lowBuffer[i];
    }
    const middle = (upper + lower) / 2;
    return { type: IndicatorType.DONCHIAN, upper, lower, middle } as DonchianValue;
  }

  protected async writeToRedis(value: IndicatorValue): Promise<void> {
    const field = this.id.replace(`${IndicatorType.DONCHIAN}:`, '');
    const v = value as DonchianValue;
    await this.hashService.set(
      INDICATOR_HASH_KEYS[IndicatorType.DONCHIAN],
      field,
      JSON.stringify({ upper: v.upper, lower: v.lower, middle: v.middle }),
    );
  }

  private static createEmptyState(period: number): DonchianState {
    return {
      highBuffer: new Array(period).fill(0),
      lowBuffer: new Array(period).fill(0),
      head: 0,
      filled: false,
    };
  }
}
