import { Injectable, Inject } from '@nestjs/common';
import { DatabaseProvider } from '@infrastructure/providers/database/database-provider.interface';
import { INFRASTRUCTURE_TOKENS } from '@infrastructure/infrastructure.tokens';
import { PgPoolService } from '@infrastructure/database/connection/pg-pool.service';
import { Candle } from '@modules/indicator/domain/models/candle.model';
import { DataSourceType } from '../../domain/enums/data-source-type.enum';
import {
  BacktestDataLoadFailedError,
  BacktestDataEmptyError,
} from '../../domain/errors/backtest.errors';
import {
  IHistoricalDataLoader,
  HistoricalDataRange,
} from './interfaces/historical-data-loader.interface';

@Injectable()
export class PostgreSqlHistoricalLoaderService implements IHistoricalDataLoader {
  readonly sourceType = DataSourceType.POSTGRESQL;

  constructor(
    @Inject(INFRASTRUCTURE_TOKENS.DATABASE_PROVIDER)
    private readonly dbProvider: DatabaseProvider,
    private readonly pool: PgPoolService,
  ) {}

  async load(range: HistoricalDataRange): Promise<Candle[]> {
    const isReady = await this.isAvailable();
    if (!isReady) {
      throw new BacktestDataLoadFailedError('postgresql', 'Database connection is not available');
    }

    try {
      const rows = await this.query(range);

      if (rows.length === 0) {
        throw new BacktestDataEmptyError(
          range.symbol,
          range.timeframe,
          range.startTime,
          range.endTime,
        );
      }

      return rows;
    } catch (e) {
      if (e instanceof BacktestDataEmptyError) throw e;
      throw new BacktestDataLoadFailedError('postgresql', (e as Error).message);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const health = await this.dbProvider.getHealth();
      return health.status === 'healthy' || health.status === 'degraded';
    } catch {
      return false;
    }
  }

  private async query(range: HistoricalDataRange): Promise<Candle[]> {
    const from = new Date(range.startTime);
    const to = new Date(range.endTime);

    const rows = await this.pool.db
      .selectFrom('candles')
      .select(['open_time', 'close_time', 'open', 'high', 'low', 'close', 'volume', 'is_final'])
      .where('exchange_id', '=', range.exchange)
      .where('symbol', '=', range.symbol)
      .where('interval', '=', range.timeframe)
      .where('open_time', '>=', from)
      .where('open_time', '<=', to)
      .orderBy('open_time', 'asc')
      .execute();

    return rows.map((row) => ({
      symbol: range.symbol,
      exchange: range.exchange,
      timeframe: range.timeframe,
      openTime: row.open_time.getTime(),
      closeTime: row.close_time.getTime(),
      open: parseFloat(row.open as string),
      high: parseFloat(row.high as string),
      low: parseFloat(row.low as string),
      close: parseFloat(row.close as string),
      volume: parseFloat(row.volume as string),
      isClosed: row.is_final,
    }));
  }
}
