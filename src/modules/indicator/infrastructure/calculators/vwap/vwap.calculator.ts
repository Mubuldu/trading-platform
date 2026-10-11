import { RedisHashService } from '@infrastructure/redis/hash/redis-hash.service';
import { IndicatorType } from '../../../domain/enums/indicator-type.enum';
import { Timeframe } from '../../../domain/enums/timeframe.enum';
import { Candle } from '../../../domain/models/candle.model';
import { VwapValue, IndicatorValue } from '../../../domain/models/indicator-value.model';
import { INDICATOR_HASH_KEYS } from '../../cache/indicator-hash-keys';
import { BaseIndicatorCalculator } from '../base/base-indicator-calculator';
import { IndicatorCalculatorConfig } from '../../../interfaces/indicator-calculator.interface';

interface VwapState {
  cumulativeTypicalPriceVolume: number;
  cumulativeVolume: number;
  sessionDate: string;
}

export function createVwapConfig(symbol: string, timeframe: Timeframe): IndicatorCalculatorConfig {
  return { type: IndicatorType.VWAP, symbol, timeframe, period: 1, params: {} };
}

export class VwapCalculator extends BaseIndicatorCalculator {
  private _s: VwapState;

  constructor(
    config: IndicatorCalculatorConfig,
    private readonly hashService: RedisHashService,
  ) {
    super(config);
    this._s = VwapCalculator.createEmptyState();
  }

  getWarmupRequired(): number {
    return 1;
  }

  protected resetState(): void {
    this._s = VwapCalculator.createEmptyState();
  }

  protected applyCandle(candle: Candle): void {
    const candleDate = new Date(candle.openTime).toISOString().slice(0, 10);

    if (this._s.sessionDate && candleDate !== this._s.sessionDate) {
      this._s.cumulativeTypicalPriceVolume = 0;
      this._s.cumulativeVolume = 0;
    }
    this._s.sessionDate = candleDate;

    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    this._s.cumulativeTypicalPriceVolume += typicalPrice * candle.volume;
    this._s.cumulativeVolume += candle.volume;
  }

  protected computeValue(): IndicatorValue {
    const vwap =
      this._s.cumulativeVolume > 0
        ? this._s.cumulativeTypicalPriceVolume / this._s.cumulativeVolume
        : 0;
    return { type: IndicatorType.VWAP, value: vwap } as VwapValue;
  }

  protected async writeToRedis(value: IndicatorValue): Promise<void> {
    const field = this.id.replace(`${IndicatorType.VWAP}:`, '');
    await this.hashService.set(
      INDICATOR_HASH_KEYS[IndicatorType.VWAP],
      field,
      (value as VwapValue).value,
    );
  }

  private static createEmptyState(): VwapState {
    return {
      cumulativeTypicalPriceVolume: 0,
      cumulativeVolume: 0,
      sessionDate: '',
    };
  }
}
