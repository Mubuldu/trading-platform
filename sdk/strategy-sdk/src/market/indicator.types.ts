import { SdkTimeframe } from './candle.types';

/**
 * SdkIndicatorType mirrors the platform's internal IndicatorType enum.
 *
 * Values are stable SDK constants. Strategy authors use them to build
 * indicator lookup keys via indicatorKey().
 */
export enum SdkIndicatorType {
  EMA          = 'ema',
  SMA          = 'sma',
  ATR          = 'atr',
  RSI          = 'rsi',
  ADX          = 'adx',
  VWAP         = 'vwap',
  DONCHIAN     = 'donchian',
  BOLLINGER    = 'bollinger',
  MACD         = 'macd',
  SUPERTREND   = 'supertrend',
  VOLUME_MA    = 'volume_ma',
  VOLUME_SPIKE = 'volume_spike',
  TRUE_RANGE   = 'true_range',
  HIGHEST_HIGH = 'highest_high',
  LOWEST_LOW   = 'lowest_low',
}

export interface SdkEmaValue   { readonly type: SdkIndicatorType.EMA;   readonly value: number; }
export interface SdkSmaValue   { readonly type: SdkIndicatorType.SMA;   readonly value: number; }
export interface SdkAtrValue   { readonly type: SdkIndicatorType.ATR;   readonly value: number; }
export interface SdkRsiValue   { readonly type: SdkIndicatorType.RSI;   readonly value: number; }
export interface SdkVwapValue  { readonly type: SdkIndicatorType.VWAP;  readonly value: number; }

export interface SdkAdxValue {
  readonly type: SdkIndicatorType.ADX;
  /** Average Directional Index — trend strength (0–100). */
  readonly adx: number;
  /** Positive Directional Indicator. */
  readonly pdi: number;
  /** Negative Directional Indicator. */
  readonly ndi: number;
}

export interface SdkDonchianValue {
  readonly type: SdkIndicatorType.DONCHIAN;
  readonly upper: number;
  readonly lower: number;
  readonly middle: number;
}

export interface SdkBollingerValue {
  readonly type: SdkIndicatorType.BOLLINGER;
  readonly upper: number;
  readonly middle: number;
  readonly lower: number;
  /** (upper - lower) / middle — normalized band width. */
  readonly bandwidth: number;
  /** (close - lower) / (upper - lower) — position within the band [0, 1]. */
  readonly percentB: number;
}

export interface SdkMacdValue {
  readonly type: SdkIndicatorType.MACD;
  readonly macd: number;
  readonly signal: number;
  readonly histogram: number;
}

export interface SdkSupertrendValue {
  readonly type: SdkIndicatorType.SUPERTREND;
  readonly value: number;
  /** 1 = uptrend (bullish), -1 = downtrend (bearish). */
  readonly direction: 1 | -1;
}

export interface SdkVolumeMaValue {
  readonly type: SdkIndicatorType.VOLUME_MA;
  readonly value: number;
}

export interface SdkVolumeSpikeValue {
  readonly type: SdkIndicatorType.VOLUME_SPIKE;
  readonly ratio: number;
  readonly avgVolume: number;
  readonly currentVolume: number;
  readonly isSpike: boolean;
}

export interface SdkTrueRangeValue    { readonly type: SdkIndicatorType.TRUE_RANGE;    readonly value: number; }
export interface SdkHighestHighValue  { readonly type: SdkIndicatorType.HIGHEST_HIGH;  readonly value: number; }
export interface SdkLowestLowValue    { readonly type: SdkIndicatorType.LOWEST_LOW;    readonly value: number; }

export type SdkIndicatorValue =
  | SdkEmaValue
  | SdkSmaValue
  | SdkAtrValue
  | SdkRsiValue
  | SdkAdxValue
  | SdkVwapValue
  | SdkDonchianValue
  | SdkBollingerValue
  | SdkMacdValue
  | SdkSupertrendValue
  | SdkVolumeMaValue
  | SdkVolumeSpikeValue
  | SdkTrueRangeValue
  | SdkHighestHighValue
  | SdkLowestLowValue;

/**
 * indicatorKey builds the standard lookup key for retrieving indicator values
 * from SdkStrategyContext.indicators.
 *
 * The key format is: `{type}:{symbol}:{timeframe}:{period}`
 *
 * Example:
 *   indicatorKey(SdkIndicatorType.EMA, 'BTC/USDT', '1h', 50) → 'ema:BTC/USDT:1h:50'
 *   indicatorKey(SdkIndicatorType.RSI, 'BTC/USDT', '4h', 14) → 'rsi:BTC/USDT:4h:14'
 *
 * Use this helper rather than constructing the key string manually to guard
 * against typos and future format changes.
 */
export function indicatorKey(
  type: SdkIndicatorType,
  symbol: string,
  timeframe: SdkTimeframe,
  period: number,
): string {
  return `${type}:${symbol}:${timeframe}:${period}`;
}
