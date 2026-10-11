import { IndicatorType } from '../enums/indicator-type.enum';

export interface EmaValue {
  readonly type: IndicatorType.EMA;
  readonly value: number;
}

export interface SmaValue {
  readonly type: IndicatorType.SMA;
  readonly value: number;
}

export interface AtrValue {
  readonly type: IndicatorType.ATR;
  readonly value: number;
}

export interface RsiValue {
  readonly type: IndicatorType.RSI;
  readonly value: number;
}

export interface AdxValue {
  readonly type: IndicatorType.ADX;
  readonly adx: number;
  readonly pdi: number;
  readonly ndi: number;
}

export interface VwapValue {
  readonly type: IndicatorType.VWAP;
  readonly value: number;
}

export interface DonchianValue {
  readonly type: IndicatorType.DONCHIAN;
  readonly upper: number;
  readonly lower: number;
  readonly middle: number;
}

export interface BollingerValue {
  readonly type: IndicatorType.BOLLINGER;
  readonly upper: number;
  readonly middle: number;
  readonly lower: number;
  readonly bandwidth: number;
  readonly percentB: number;
}

export interface MacdValue {
  readonly type: IndicatorType.MACD;
  readonly macd: number;
  readonly signal: number;
  readonly histogram: number;
}

export interface SupertrendValue {
  readonly type: IndicatorType.SUPERTREND;
  readonly value: number;
  readonly direction: 1 | -1;
}

export interface VolumeMaValue {
  readonly type: IndicatorType.VOLUME_MA;
  readonly value: number;
}

export interface VolumeSpikeValue {
  readonly type: IndicatorType.VOLUME_SPIKE;
  readonly ratio: number;
  readonly avgVolume: number;
  readonly currentVolume: number;
  readonly isSpike: boolean;
}

export interface TrueRangeValue {
  readonly type: IndicatorType.TRUE_RANGE;
  readonly value: number;
}

export interface HighestHighValue {
  readonly type: IndicatorType.HIGHEST_HIGH;
  readonly value: number;
}

export interface LowestLowValue {
  readonly type: IndicatorType.LOWEST_LOW;
  readonly value: number;
}

export type IndicatorValue =
  | EmaValue
  | SmaValue
  | AtrValue
  | RsiValue
  | AdxValue
  | VwapValue
  | DonchianValue
  | BollingerValue
  | MacdValue
  | SupertrendValue
  | VolumeMaValue
  | VolumeSpikeValue
  | TrueRangeValue
  | HighestHighValue
  | LowestLowValue;
