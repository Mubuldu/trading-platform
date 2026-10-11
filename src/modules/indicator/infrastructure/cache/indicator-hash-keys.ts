import { IndicatorType } from '../../domain/enums/indicator-type.enum';

export const INDICATOR_HASH_KEYS: Record<IndicatorType, string> = {
  [IndicatorType.EMA]: 'indicator:ema',
  [IndicatorType.SMA]: 'indicator:sma',
  [IndicatorType.ATR]: 'indicator:atr',
  [IndicatorType.RSI]: 'indicator:rsi',
  [IndicatorType.ADX]: 'indicator:adx',
  [IndicatorType.VWAP]: 'indicator:vwap',
  [IndicatorType.DONCHIAN]: 'indicator:donchian',
  [IndicatorType.BOLLINGER]: 'indicator:bollinger',
  [IndicatorType.MACD]: 'indicator:macd',
  [IndicatorType.SUPERTREND]: 'indicator:supertrend',
  [IndicatorType.VOLUME_MA]: 'indicator:volume_ma',
  [IndicatorType.VOLUME_SPIKE]: 'indicator:volume_spike',
  [IndicatorType.TRUE_RANGE]: 'indicator:true_range',
  [IndicatorType.HIGHEST_HIGH]: 'indicator:highest_high',
  [IndicatorType.LOWEST_LOW]: 'indicator:lowest_low',
};
