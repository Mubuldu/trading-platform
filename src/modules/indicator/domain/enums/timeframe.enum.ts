export enum Timeframe {
  ONE_MINUTE = '1m',
  FIVE_MINUTES = '5m',
  FIFTEEN_MINUTES = '15m',
  ONE_HOUR = '1h',
}

export const TIMEFRAME_TO_STREAM: Record<Timeframe, string> = {
  [Timeframe.ONE_MINUTE]: 'market:kline:1m',
  [Timeframe.FIVE_MINUTES]: 'market:kline:5m',
  [Timeframe.FIFTEEN_MINUTES]: 'market:kline:15m',
  [Timeframe.ONE_HOUR]: 'market:kline:1h',
};
