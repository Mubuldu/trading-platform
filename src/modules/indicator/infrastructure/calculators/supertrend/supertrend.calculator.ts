import { RedisHashService } from '@infrastructure/redis/hash/redis-hash.service';
import { IndicatorType } from '../../../domain/enums/indicator-type.enum';
import { Timeframe } from '../../../domain/enums/timeframe.enum';
import { Candle } from '../../../domain/models/candle.model';
import { SupertrendValue, IndicatorValue } from '../../../domain/models/indicator-value.model';
import { INDICATOR_HASH_KEYS } from '../../cache/indicator-hash-keys';
import { BaseIndicatorCalculator } from '../base/base-indicator-calculator';
import { IndicatorCalculatorConfig } from '../../../interfaces/indicator-calculator.interface';

interface SupertrendState {
  previousAtr: number;
  previousClose: number;
  previousUpperBand: number;
  previousLowerBand: number;
  previousSupertrend: number;
  previousDirection: 1 | -1;
  seedTr: number[];
  seeded: boolean;
}

export function createSupertrendConfig(
  symbol: string,
  timeframe: Timeframe,
  period = 10,
  multiplier = 3,
): IndicatorCalculatorConfig {
  return {
    type: IndicatorType.SUPERTREND,
    symbol,
    timeframe,
    period,
    params: { multiplier },
  };
}

export class SupertrendCalculator extends BaseIndicatorCalculator {
  private _s: SupertrendState;
  private readonly multiplier: number;

  constructor(
    config: IndicatorCalculatorConfig,
    private readonly hashService: RedisHashService,
  ) {
    super(config);
    this.multiplier = config.params.multiplier ?? 3;
    this._s = SupertrendCalculator.createEmptyState();
  }

  getWarmupRequired(): number {
    return this.config.period + 1;
  }

  protected resetState(): void {
    this._s = SupertrendCalculator.createEmptyState();
  }

  protected applyCandle(candle: Candle): void {
    const tr =
      this._s.previousClose === 0
        ? candle.high - candle.low
        : Math.max(
            candle.high - candle.low,
            Math.abs(candle.high - this._s.previousClose),
            Math.abs(candle.low - this._s.previousClose),
          );

    const prevClose = this._s.previousClose;

    if (!this._s.seeded) {
      this._s.seedTr.push(tr);
      if (this._s.seedTr.length === this.config.period) {
        this._s.previousAtr = this._s.seedTr.reduce((a, b) => a + b, 0) / this.config.period;
        this._s.seedTr = [];
        this._s.seeded = true;
      }
    } else {
      this._s.previousAtr =
        (this._s.previousAtr * (this.config.period - 1) + tr) / this.config.period;
    }

    this._s.previousClose = candle.close;

    if (!this._s.seeded) return;

    const hl2 = (candle.high + candle.low) / 2;
    const atr = this._s.previousAtr;
    const rawUpper = hl2 + this.multiplier * atr;
    const rawLower = hl2 - this.multiplier * atr;

    // Band carry-forward uses previous candle's close (prevClose), not current
    const upperBand =
      rawUpper < this._s.previousUpperBand || prevClose > this._s.previousUpperBand
        ? rawUpper
        : this._s.previousUpperBand;

    const lowerBand =
      rawLower > this._s.previousLowerBand || prevClose < this._s.previousLowerBand
        ? rawLower
        : this._s.previousLowerBand;

    let direction: 1 | -1;
    if (this._s.previousSupertrend === 0) {
      direction = candle.close > rawLower ? 1 : -1;
    } else if (this._s.previousSupertrend === this._s.previousUpperBand) {
      direction = candle.close > upperBand ? 1 : -1;
    } else {
      direction = candle.close < lowerBand ? -1 : 1;
    }

    const supertrend = direction === 1 ? lowerBand : upperBand;

    this._s.previousUpperBand = upperBand;
    this._s.previousLowerBand = lowerBand;
    this._s.previousSupertrend = supertrend;
    this._s.previousDirection = direction;
  }

  protected computeValue(): IndicatorValue {
    return {
      type: IndicatorType.SUPERTREND,
      value: this._s.previousSupertrend,
      direction: this._s.previousDirection,
    } as SupertrendValue;
  }

  protected async writeToRedis(value: IndicatorValue): Promise<void> {
    const field = this.id.replace(`${IndicatorType.SUPERTREND}:`, '');
    const v = value as SupertrendValue;
    await this.hashService.set(
      INDICATOR_HASH_KEYS[IndicatorType.SUPERTREND],
      field,
      JSON.stringify({ value: v.value, direction: v.direction }),
    );
  }

  private static createEmptyState(): SupertrendState {
    return {
      previousAtr: 0,
      previousClose: 0,
      previousUpperBand: 0,
      previousLowerBand: 0,
      previousSupertrend: 0,
      previousDirection: 1,
      seedTr: [],
      seeded: false,
    };
  }
}
