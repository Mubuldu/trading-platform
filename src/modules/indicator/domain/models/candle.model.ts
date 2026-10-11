import { Timeframe } from '../enums/timeframe.enum';

export interface Candle {
  readonly symbol: string;
  readonly exchange: string;
  readonly timeframe: Timeframe;
  readonly openTime: number;
  readonly closeTime: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  readonly isClosed: boolean;
}
