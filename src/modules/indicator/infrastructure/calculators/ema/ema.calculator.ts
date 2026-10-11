import { RedisHashService } from '@infrastructure/redis/hash/redis-hash.service';
import { IndicatorType } from '../../../domain/enums/indicator-type.enum';
import { Timeframe } from '../../../domain/enums/timeframe.enum';
import { Candle } from '../../../domain/models/candle.model';
import { EmaValue, IndicatorValue } from '../../../domain/models/indicator-value.model';
import { INDICATOR_HASH_KEYS } from '../../cache/indicator-hash-keys';
import { BaseIndicatorCalculator } from '../base/base-indicator-calculator';
import { IndicatorCalculatorConfig } from '../../../interfaces/indicator-calculator.interface';

interface EmaState {
  previousEma: number;
  k: number;
  seedValues: number[];
}

export function createEmaConfig(
  symbol: string,
  timeframe: Timeframe,
  period: number,
): IndicatorCalculatorConfig {
  return { type: IndicatorType.EMA, symbol, timeframe, period, params: {} };
}

export class EmaCalculator extends BaseIndicatorCalculator {
  private _s: EmaState;

  constructor(
    config: IndicatorCalculatorConfig,
    private readonly hashService: RedisHashService,
  ) {
    super(config);
    this._s = EmaCalculator.createEmptyState(config.period);
  }

  protected resetState(): void {
    this._s = EmaCalculator.createEmptyState(this.config.period);
  }

  protected applyCandle(candle: Candle): void {
    const price = candle.close;

    if (this._s.previousEma === 0) {
      this._s.seedValues.push(price);
      if (this._s.seedValues.length === this.config.period) {
        const seed = this._s.seedValues.reduce((a, b) => a + b, 0) / this.config.period;
        this._s.previousEma = seed;
        this._s.seedValues = [];
      }
    } else {
      this._s.previousEma = price * this._s.k + this._s.previousEma * (1 - this._s.k);
    }
  }

  protected computeValue(): IndicatorValue {
    return { type: IndicatorType.EMA, value: this._s.previousEma } as EmaValue;
  }

  protected async writeToRedis(value: IndicatorValue): Promise<void> {
    const field = this.id.replace(`${IndicatorType.EMA}:`, '');
    await this.hashService.set(
      INDICATOR_HASH_KEYS[IndicatorType.EMA],
      field,
      (value as EmaValue).value,
    );
  }

  private static createEmptyState(period: number): EmaState {
    return {
      previousEma: 0,
      k: 2 / (period + 1),
      seedValues: [],
    };
  }
}
