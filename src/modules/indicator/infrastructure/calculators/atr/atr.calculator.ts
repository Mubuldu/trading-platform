import { RedisHashService } from '@infrastructure/redis/hash/redis-hash.service';
import { IndicatorType } from '../../../domain/enums/indicator-type.enum';
import { Timeframe } from '../../../domain/enums/timeframe.enum';
import { Candle } from '../../../domain/models/candle.model';
import { AtrValue, IndicatorValue } from '../../../domain/models/indicator-value.model';
import { INDICATOR_HASH_KEYS } from '../../cache/indicator-hash-keys';
import { BaseIndicatorCalculator } from '../base/base-indicator-calculator';
import { IndicatorCalculatorConfig } from '../../../interfaces/indicator-calculator.interface';

interface AtrState {
  previousAtr: number;
  previousClose: number;
  seedTrueRanges: number[];
  seeded: boolean;
}

export function createAtrConfig(
  symbol: string,
  timeframe: Timeframe,
  period: number,
): IndicatorCalculatorConfig {
  return { type: IndicatorType.ATR, symbol, timeframe, period, params: {} };
}

export class AtrCalculator extends BaseIndicatorCalculator {
  private _s: AtrState;

  constructor(
    config: IndicatorCalculatorConfig,
    private readonly hashService: RedisHashService,
  ) {
    super(config);
    this._s = AtrCalculator.createEmptyState();
  }

  getWarmupRequired(): number {
    return this.config.period + 1;
  }

  protected resetState(): void {
    this._s = AtrCalculator.createEmptyState();
  }

  protected applyCandle(candle: Candle): void {
    const tr = this.trueRange(candle);

    if (!this._s.seeded) {
      this._s.seedTrueRanges.push(tr);
      if (this._s.seedTrueRanges.length === this.config.period) {
        this._s.previousAtr =
          this._s.seedTrueRanges.reduce((a, b) => a + b, 0) / this.config.period;
        this._s.seedTrueRanges = [];
        this._s.seeded = true;
      }
    } else {
      this._s.previousAtr =
        (this._s.previousAtr * (this.config.period - 1) + tr) / this.config.period;
    }

    this._s.previousClose = candle.close;
  }

  protected computeValue(): IndicatorValue {
    return { type: IndicatorType.ATR, value: this._s.previousAtr } as AtrValue;
  }

  protected async writeToRedis(value: IndicatorValue): Promise<void> {
    const field = this.id.replace(`${IndicatorType.ATR}:`, '');
    await this.hashService.set(
      INDICATOR_HASH_KEYS[IndicatorType.ATR],
      field,
      (value as AtrValue).value,
    );
  }

  private trueRange(candle: Candle): number {
    if (this._s.previousClose === 0) {
      return candle.high - candle.low;
    }
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - this._s.previousClose),
      Math.abs(candle.low - this._s.previousClose),
    );
  }

  private static createEmptyState(): AtrState {
    return {
      previousAtr: 0,
      previousClose: 0,
      seedTrueRanges: [],
      seeded: false,
    };
  }
}
