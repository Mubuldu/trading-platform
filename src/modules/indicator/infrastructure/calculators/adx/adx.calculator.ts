import { RedisHashService } from '@infrastructure/redis/hash/redis-hash.service';
import { IndicatorType } from '../../../domain/enums/indicator-type.enum';
import { Timeframe } from '../../../domain/enums/timeframe.enum';
import { Candle } from '../../../domain/models/candle.model';
import { AdxValue, IndicatorValue } from '../../../domain/models/indicator-value.model';
import { INDICATOR_HASH_KEYS } from '../../cache/indicator-hash-keys';
import { BaseIndicatorCalculator } from '../base/base-indicator-calculator';
import { IndicatorCalculatorConfig } from '../../../interfaces/indicator-calculator.interface';

interface AdxState {
  previousHigh: number;
  previousLow: number;
  previousClose: number;
  smoothedTr: number;
  smoothedDmPlus: number;
  smoothedDmMinus: number;
  smoothedAdx: number;
  seedTr: number[];
  seedDmPlus: number[];
  seedDmMinus: number[];
  seedDx: number[];
  phase: 'seeding_dm' | 'seeding_dx' | 'ready';
}

export function createAdxConfig(
  symbol: string,
  timeframe: Timeframe,
  period: number,
): IndicatorCalculatorConfig {
  return { type: IndicatorType.ADX, symbol, timeframe, period, params: {} };
}

export class AdxCalculator extends BaseIndicatorCalculator {
  private _s: AdxState;

  constructor(
    config: IndicatorCalculatorConfig,
    private readonly hashService: RedisHashService,
  ) {
    super(config);
    this._s = AdxCalculator.createEmptyState();
  }

  getWarmupRequired(): number {
    return this.config.period * 2;
  }

  protected resetState(): void {
    this._s = AdxCalculator.createEmptyState();
  }

  protected applyCandle(candle: Candle): void {
    if (this._s.previousClose === 0) {
      this._s.previousHigh = candle.high;
      this._s.previousLow = candle.low;
      this._s.previousClose = candle.close;
      return;
    }

    const tr = Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - this._s.previousClose),
      Math.abs(candle.low - this._s.previousClose),
    );
    const dmPlus =
      candle.high - this._s.previousHigh > this._s.previousLow - candle.low
        ? Math.max(candle.high - this._s.previousHigh, 0)
        : 0;
    const dmMinus =
      this._s.previousLow - candle.low > candle.high - this._s.previousHigh
        ? Math.max(this._s.previousLow - candle.low, 0)
        : 0;

    const period = this.config.period;

    if (this._s.phase === 'seeding_dm') {
      this._s.seedTr.push(tr);
      this._s.seedDmPlus.push(dmPlus);
      this._s.seedDmMinus.push(dmMinus);

      if (this._s.seedTr.length === period) {
        this._s.smoothedTr = this._s.seedTr.reduce((a, b) => a + b, 0);
        this._s.smoothedDmPlus = this._s.seedDmPlus.reduce((a, b) => a + b, 0);
        this._s.smoothedDmMinus = this._s.seedDmMinus.reduce((a, b) => a + b, 0);
        this._s.seedTr = [];
        this._s.seedDmPlus = [];
        this._s.seedDmMinus = [];

        const dx = this.computeDx();
        this._s.seedDx.push(dx);
        this._s.phase = 'seeding_dx';
      }
    } else if (this._s.phase === 'seeding_dx') {
      this._s.smoothedTr = this._s.smoothedTr - this._s.smoothedTr / period + tr;
      this._s.smoothedDmPlus = this._s.smoothedDmPlus - this._s.smoothedDmPlus / period + dmPlus;
      this._s.smoothedDmMinus =
        this._s.smoothedDmMinus - this._s.smoothedDmMinus / period + dmMinus;

      const dx = this.computeDx();
      this._s.seedDx.push(dx);

      if (this._s.seedDx.length === period) {
        this._s.smoothedAdx = this._s.seedDx.reduce((a, b) => a + b, 0) / period;
        this._s.seedDx = [];
        this._s.phase = 'ready';
      }
    } else {
      this._s.smoothedTr = this._s.smoothedTr - this._s.smoothedTr / period + tr;
      this._s.smoothedDmPlus = this._s.smoothedDmPlus - this._s.smoothedDmPlus / period + dmPlus;
      this._s.smoothedDmMinus =
        this._s.smoothedDmMinus - this._s.smoothedDmMinus / period + dmMinus;

      const dx = this.computeDx();
      this._s.smoothedAdx = (this._s.smoothedAdx * (period - 1) + dx) / period;
    }

    this._s.previousHigh = candle.high;
    this._s.previousLow = candle.low;
    this._s.previousClose = candle.close;
  }

  protected computeValue(): IndicatorValue {
    const { smoothedTr, smoothedDmPlus, smoothedDmMinus, smoothedAdx } = this._s;
    const pdi = smoothedTr !== 0 ? (smoothedDmPlus / smoothedTr) * 100 : 0;
    const ndi = smoothedTr !== 0 ? (smoothedDmMinus / smoothedTr) * 100 : 0;
    return { type: IndicatorType.ADX, adx: smoothedAdx, pdi, ndi } as AdxValue;
  }

  protected async writeToRedis(value: IndicatorValue): Promise<void> {
    const field = this.id.replace(`${IndicatorType.ADX}:`, '');
    const v = value as AdxValue;
    await this.hashService.set(
      INDICATOR_HASH_KEYS[IndicatorType.ADX],
      field,
      JSON.stringify({ adx: v.adx, pdi: v.pdi, ndi: v.ndi }),
    );
  }

  private computeDx(): number {
    const { smoothedTr, smoothedDmPlus, smoothedDmMinus } = this._s;
    if (smoothedTr === 0) return 0;
    const pdi = (smoothedDmPlus / smoothedTr) * 100;
    const ndi = (smoothedDmMinus / smoothedTr) * 100;
    const diSum = pdi + ndi;
    return diSum !== 0 ? (Math.abs(pdi - ndi) / diSum) * 100 : 0;
  }

  private static createEmptyState(): AdxState {
    return {
      previousHigh: 0,
      previousLow: 0,
      previousClose: 0,
      smoothedTr: 0,
      smoothedDmPlus: 0,
      smoothedDmMinus: 0,
      smoothedAdx: 0,
      seedTr: [],
      seedDmPlus: [],
      seedDmMinus: [],
      seedDx: [],
      phase: 'seeding_dm',
    };
  }
}
