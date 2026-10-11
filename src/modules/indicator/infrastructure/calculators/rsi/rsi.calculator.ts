import { RedisHashService } from '@infrastructure/redis/hash/redis-hash.service';
import { IndicatorType } from '../../../domain/enums/indicator-type.enum';
import { Timeframe } from '../../../domain/enums/timeframe.enum';
import { Candle } from '../../../domain/models/candle.model';
import { RsiValue, IndicatorValue } from '../../../domain/models/indicator-value.model';
import { INDICATOR_HASH_KEYS } from '../../cache/indicator-hash-keys';
import { BaseIndicatorCalculator } from '../base/base-indicator-calculator';
import { IndicatorCalculatorConfig } from '../../../interfaces/indicator-calculator.interface';

interface RsiState {
  avgGain: number;
  avgLoss: number;
  previousClose: number;
  seedGains: number[];
  seedLosses: number[];
  seeded: boolean;
}

export function createRsiConfig(
  symbol: string,
  timeframe: Timeframe,
  period: number,
): IndicatorCalculatorConfig {
  return { type: IndicatorType.RSI, symbol, timeframe, period, params: {} };
}

export class RsiCalculator extends BaseIndicatorCalculator {
  private _s: RsiState;

  constructor(
    config: IndicatorCalculatorConfig,
    private readonly hashService: RedisHashService,
  ) {
    super(config);
    this._s = RsiCalculator.createEmptyState();
  }

  getWarmupRequired(): number {
    return this.config.period + 1;
  }

  protected resetState(): void {
    this._s = RsiCalculator.createEmptyState();
  }

  protected applyCandle(candle: Candle): void {
    if (this._s.previousClose === 0) {
      this._s.previousClose = candle.close;
      return;
    }

    const change = candle.close - this._s.previousClose;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    if (!this._s.seeded) {
      this._s.seedGains.push(gain);
      this._s.seedLosses.push(loss);

      if (this._s.seedGains.length === this.config.period) {
        this._s.avgGain = this._s.seedGains.reduce((a, b) => a + b, 0) / this.config.period;
        this._s.avgLoss = this._s.seedLosses.reduce((a, b) => a + b, 0) / this.config.period;
        this._s.seedGains = [];
        this._s.seedLosses = [];
        this._s.seeded = true;
      }
    } else {
      this._s.avgGain = (this._s.avgGain * (this.config.period - 1) + gain) / this.config.period;
      this._s.avgLoss = (this._s.avgLoss * (this.config.period - 1) + loss) / this.config.period;
    }

    this._s.previousClose = candle.close;
  }

  protected computeValue(): IndicatorValue {
    const { avgGain, avgLoss } = this._s;
    let rsi: number;
    if (avgLoss === 0) {
      rsi = 100;
    } else {
      const rs = avgGain / avgLoss;
      rsi = 100 - 100 / (1 + rs);
    }
    return { type: IndicatorType.RSI, value: rsi } as RsiValue;
  }

  protected async writeToRedis(value: IndicatorValue): Promise<void> {
    const field = this.id.replace(`${IndicatorType.RSI}:`, '');
    await this.hashService.set(
      INDICATOR_HASH_KEYS[IndicatorType.RSI],
      field,
      (value as RsiValue).value,
    );
  }

  private static createEmptyState(): RsiState {
    return {
      avgGain: 0,
      avgLoss: 0,
      previousClose: 0,
      seedGains: [],
      seedLosses: [],
      seeded: false,
    };
  }
}
