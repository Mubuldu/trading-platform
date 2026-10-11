import { Candle } from '@modules/indicator/domain/models/candle.model';
import { Timeframe } from '@modules/indicator/domain/enums/timeframe.enum';
import { DataSourceType } from '../../../domain/enums/data-source-type.enum';

export interface HistoricalDataRange {
  readonly symbol: string;
  readonly exchange: string;
  readonly timeframe: Timeframe;
  readonly startTime: number;
  readonly endTime: number;
}

export interface IHistoricalDataLoader {
  readonly sourceType: DataSourceType;

  load(range: HistoricalDataRange): Promise<Candle[]>;

  isAvailable(): Promise<boolean>;
}
