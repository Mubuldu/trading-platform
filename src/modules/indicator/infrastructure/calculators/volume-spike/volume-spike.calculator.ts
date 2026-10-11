import { RedisHashService } from '@infrastructure/redis/hash/redis-hash.service';
import { IndicatorType } from '../../../domain/enums/indicator-type.enum';
import { Timeframe } from '../../../domain/enums/timeframe.enum';
import { Candle } from '../../../domain/models/candle.model';
import { VolumeSpikeValue, IndicatorValue } from '../../../domain/models/indicator-value.model';
import { INDICATOR_HASH_KEYS } from '../../cache/indicator-hash-keys';
import { BaseIndicatorCalculator } from '../base/base-indicator-calculator';
import { IndicatorCalculatorConfig } from '../../../interfaces/indicator-calculator.interface';

interface VolumeSpikeState {
  volumeBuffer: number[];
  head: number;
  sum: number;
  filled: boolean;
}

export function createVolumeSpikeConfig(
  symbol: string,
  timeframe: Timeframe,
  period: number,
  threshold = 2.0,
): IndicatorCalculatorConfig {
  return { type: IndicatorType.VOLUME_SPIKE, symbol, timeframe, period, params: { threshold } };
}

/**
 * Volume Spike Detector
 *
 * Formula: avgVolume = sum(volume_i) / period; ratio = currentVolume / avgVolume; isSpike = ratio > threshold
 * Inputs: volume, configurable threshold (default 2.0)
 * Outputs: VolumeSpikeValue — ratio, avgVolume, currentVolume, isSpike
 * Warmup: period candles
 * Complexity: O(1) per update
 * Failure modes: avgVolume=0 guarded to avoid division by zero (ratio=1, isSpike=false)
 */
export class VolumeSpikeCalculator extends BaseIndicatorCalculator {
  private _s: VolumeSpikeState;
  private readonly threshold: number;

  constructor(
    config: IndicatorCalculatorConfig,
    private readonly hashService: RedisHashService,
  ) {
    super(config);
    this.threshold = config.params.threshold ?? 2.0;
    this._s = VolumeSpikeCalculator.createEmptyState(config.period);
  }

  protected resetState(): void {
    this._s = VolumeSpikeCalculator.createEmptyState(this.config.period);
  }

  protected applyCandle(candle: Candle): void {
    const { head, volumeBuffer } = this._s;
    const period = this.config.period;
    const evicting = volumeBuffer[head];

    volumeBuffer[head] = candle.volume;
    this._s.head = (head + 1) % period;
    this._s.sum = this._s.sum - evicting + candle.volume;

    if (!this._s.filled && this._s.head === 0) {
      this._s.filled = true;
    }
  }

  protected computeValue(): IndicatorValue {
    const period = this.config.period;
    const avgVolume = this._s.sum / period;
    // Most recently inserted volume is at head - 1 (circular buffer, head already advanced)
    const currentIdx = (this._s.head - 1 + period) % period;
    const currentVolume = this._s.volumeBuffer[currentIdx];
    const ratio = avgVolume > 0 ? currentVolume / avgVolume : 1;
    const isSpike = ratio > this.threshold;

    return {
      type: IndicatorType.VOLUME_SPIKE,
      ratio,
      avgVolume,
      currentVolume,
      isSpike,
    } as VolumeSpikeValue;
  }

  protected async writeToRedis(value: IndicatorValue): Promise<void> {
    const field = this.id.replace(`${IndicatorType.VOLUME_SPIKE}:`, '');
    const v = value as VolumeSpikeValue;
    await this.hashService.set(
      INDICATOR_HASH_KEYS[IndicatorType.VOLUME_SPIKE],
      field,
      JSON.stringify({
        ratio: v.ratio,
        avgVolume: v.avgVolume,
        currentVolume: v.currentVolume,
        isSpike: v.isSpike,
      }),
    );
  }

  private static createEmptyState(period: number): VolumeSpikeState {
    return {
      volumeBuffer: new Array(period).fill(0),
      head: 0,
      sum: 0,
      filled: false,
    };
  }
}
