import { RedisHashService } from '@infrastructure/redis/hash/redis-hash.service';
import { IndicatorType } from '../../../domain/enums/indicator-type.enum';
import { Timeframe } from '../../../domain/enums/timeframe.enum';
import { Candle } from '../../../domain/models/candle.model';
import { MacdValue, IndicatorValue } from '../../../domain/models/indicator-value.model';
import { INDICATOR_HASH_KEYS } from '../../cache/indicator-hash-keys';
import { BaseIndicatorCalculator } from '../base/base-indicator-calculator';
import { IndicatorCalculatorConfig } from '../../../interfaces/indicator-calculator.interface';

interface MacdState {
  fastEma: number;
  slowEma: number;
  signalEma: number;
  fastSeed: number[];
  slowSeed: number[];
  macdSeed: number[];
  phase: 'seeding_slow' | 'seeding_signal' | 'ready';
}

export function createMacdConfig(
  symbol: string,
  timeframe: Timeframe,
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): IndicatorCalculatorConfig {
  return {
    type: IndicatorType.MACD,
    symbol,
    timeframe,
    period: slowPeriod,
    params: { fastPeriod, slowPeriod, signalPeriod },
  };
}

export class MacdCalculator extends BaseIndicatorCalculator {
  private _s: MacdState;
  private readonly fastPeriod: number;
  private readonly slowPeriod: number;
  private readonly signalPeriod: number;
  private readonly fastK: number;
  private readonly slowK: number;
  private readonly signalK: number;

  constructor(
    config: IndicatorCalculatorConfig,
    private readonly hashService: RedisHashService,
  ) {
    super(config);
    this.fastPeriod = config.params.fastPeriod ?? 12;
    this.slowPeriod = config.params.slowPeriod ?? 26;
    this.signalPeriod = config.params.signalPeriod ?? 9;
    this.fastK = 2 / (this.fastPeriod + 1);
    this.slowK = 2 / (this.slowPeriod + 1);
    this.signalK = 2 / (this.signalPeriod + 1);
    this._s = MacdCalculator.createEmptyState();
  }

  getWarmupRequired(): number {
    return this.slowPeriod + this.signalPeriod;
  }

  protected resetState(): void {
    this._s = MacdCalculator.createEmptyState();
  }

  protected applyCandle(candle: Candle): void {
    const price = candle.close;

    if (this._s.phase === 'seeding_slow') {
      this._s.fastSeed.push(price);
      this._s.slowSeed.push(price);

      if (this._s.slowSeed.length === this.slowPeriod) {
        const fastSlice = this._s.fastSeed.slice(this.slowPeriod - this.fastPeriod);
        this._s.fastEma = fastSlice.reduce((a, b) => a + b, 0) / this.fastPeriod;
        this._s.slowEma = this._s.slowSeed.reduce((a, b) => a + b, 0) / this.slowPeriod;
        this._s.fastSeed = [];
        this._s.slowSeed = [];

        const macd = this._s.fastEma - this._s.slowEma;
        this._s.macdSeed.push(macd);
        this._s.phase = 'seeding_signal';
      }
    } else if (this._s.phase === 'seeding_signal') {
      this._s.fastEma = price * this.fastK + this._s.fastEma * (1 - this.fastK);
      this._s.slowEma = price * this.slowK + this._s.slowEma * (1 - this.slowK);
      const macd = this._s.fastEma - this._s.slowEma;
      this._s.macdSeed.push(macd);

      if (this._s.macdSeed.length === this.signalPeriod) {
        this._s.signalEma = this._s.macdSeed.reduce((a, b) => a + b, 0) / this.signalPeriod;
        this._s.macdSeed = [];
        this._s.phase = 'ready';
      }
    } else {
      this._s.fastEma = price * this.fastK + this._s.fastEma * (1 - this.fastK);
      this._s.slowEma = price * this.slowK + this._s.slowEma * (1 - this.slowK);
      const macd = this._s.fastEma - this._s.slowEma;
      this._s.signalEma = macd * this.signalK + this._s.signalEma * (1 - this.signalK);
    }
  }

  protected computeValue(): IndicatorValue {
    const macd = this._s.fastEma - this._s.slowEma;
    const signal = this._s.signalEma;
    return { type: IndicatorType.MACD, macd, signal, histogram: macd - signal } as MacdValue;
  }

  protected async writeToRedis(value: IndicatorValue): Promise<void> {
    const field = this.id.replace(`${IndicatorType.MACD}:`, '');
    const v = value as MacdValue;
    await this.hashService.set(
      INDICATOR_HASH_KEYS[IndicatorType.MACD],
      field,
      JSON.stringify({ macd: v.macd, signal: v.signal, histogram: v.histogram }),
    );
  }

  private static createEmptyState(): MacdState {
    return {
      fastEma: 0,
      slowEma: 0,
      signalEma: 0,
      fastSeed: [],
      slowSeed: [],
      macdSeed: [],
      phase: 'seeding_slow',
    };
  }
}
