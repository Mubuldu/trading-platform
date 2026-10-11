import { Injectable } from '@nestjs/common';
import { DataSourceType } from '../../domain/enums/data-source-type.enum';
import { BacktestConfigInvalidError } from '../../domain/errors/backtest.errors';
import { IHistoricalDataLoader } from './interfaces/historical-data-loader.interface';
import { CsvHistoricalLoaderService } from './csv-historical-loader.service';
import { PostgreSqlHistoricalLoaderService } from './postgresql-historical-loader.service';
import { BinanceHistoricalFeedService } from './binance-historical-feed.service';

@Injectable()
export class HistoricalLoaderFactoryService {
  constructor(
    private readonly csvLoader: CsvHistoricalLoaderService,
    private readonly postgresLoader: PostgreSqlHistoricalLoaderService,
    private readonly binanceLoader: BinanceHistoricalFeedService,
  ) {}

  resolve(sourceType: DataSourceType): IHistoricalDataLoader {
    switch (sourceType) {
      case DataSourceType.CSV:
        return this.csvLoader;
      case DataSourceType.POSTGRESQL:
        return this.postgresLoader;
      case DataSourceType.BINANCE:
        return this.binanceLoader;
      default:
        throw new BacktestConfigInvalidError(`Unknown data source type: ${sourceType as string}`);
    }
  }
}
