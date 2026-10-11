import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { RedisHashService } from '@infrastructure/redis/hash/redis-hash.service';
import { IndicatorType } from '../../domain/enums/indicator-type.enum';
import { IndicatorValue } from '../../domain/models/indicator-value.model';
import { INDICATOR_HASH_KEYS } from '../cache/indicator-hash-keys';
import {
  EmaValue,
  SmaValue,
  AtrValue,
  RsiValue,
  AdxValue,
  VwapValue,
  DonchianValue,
  BollingerValue,
  MacdValue,
  SupertrendValue,
  VolumeMaValue,
  VolumeSpikeValue,
  TrueRangeValue,
  HighestHighValue,
  LowestLowValue,
} from '../../domain/models/indicator-value.model';

@Injectable()
export class IndicatorPublisherService {
  private readonly context = IndicatorPublisherService.name;

  constructor(
    private readonly hashService: RedisHashService,
    private readonly logger: AppLoggerService,
  ) {}

  async publish(field: string, value: IndicatorValue): Promise<void> {
    const key = INDICATOR_HASH_KEYS[value.type];
    const serialized = this.serialize(value);
    try {
      await this.hashService.set(key, field, serialized);
    } catch (err) {
      this.logger.error(
        `Failed to publish indicator ${value.type} field=${field}: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
        this.context,
      );
      throw err;
    }
  }

  async publishBatch(entries: Array<{ field: string; value: IndicatorValue }>): Promise<void> {
    await Promise.all(entries.map(({ field, value }) => this.publish(field, value)));
  }

  private serialize(value: IndicatorValue): string {
    switch (value.type) {
      case IndicatorType.EMA:
        return String((value as EmaValue).value);
      case IndicatorType.SMA:
        return String((value as SmaValue).value);
      case IndicatorType.ATR:
        return String((value as AtrValue).value);
      case IndicatorType.RSI:
        return String((value as RsiValue).value);
      case IndicatorType.VWAP:
        return String((value as VwapValue).value);
      case IndicatorType.VOLUME_MA:
        return String((value as VolumeMaValue).value);
      case IndicatorType.TRUE_RANGE:
        return String((value as TrueRangeValue).value);
      case IndicatorType.HIGHEST_HIGH:
        return String((value as HighestHighValue).value);
      case IndicatorType.LOWEST_LOW:
        return String((value as LowestLowValue).value);
      case IndicatorType.ADX: {
        const v = value as AdxValue;
        return JSON.stringify({ adx: v.adx, pdi: v.pdi, ndi: v.ndi });
      }
      case IndicatorType.DONCHIAN: {
        const v = value as DonchianValue;
        return JSON.stringify({ upper: v.upper, lower: v.lower, middle: v.middle });
      }
      case IndicatorType.BOLLINGER: {
        const v = value as BollingerValue;
        return JSON.stringify({
          upper: v.upper,
          middle: v.middle,
          lower: v.lower,
          bandwidth: v.bandwidth,
          percentB: v.percentB,
        });
      }
      case IndicatorType.MACD: {
        const v = value as MacdValue;
        return JSON.stringify({ macd: v.macd, signal: v.signal, histogram: v.histogram });
      }
      case IndicatorType.SUPERTREND: {
        const v = value as SupertrendValue;
        return JSON.stringify({ value: v.value, direction: v.direction });
      }
      case IndicatorType.VOLUME_SPIKE: {
        const v = value as VolumeSpikeValue;
        return JSON.stringify({
          ratio: v.ratio,
          avgVolume: v.avgVolume,
          currentVolume: v.currentVolume,
          isSpike: v.isSpike,
        });
      }
    }
  }
}
