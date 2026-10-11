import { Injectable } from '@nestjs/common';
import { ok, err, Result } from '@common/result';
import { DatabaseError } from '@common/errors/infrastructure.error';
import { PgPoolService } from '../connection/pg-pool.service';
import { AuditService } from '../audit/audit.service';
import { AuditContext } from '../audit/audit-event.types';
import { Candle, NewCandle } from '../types/database.types';
import { PgBaseRepository } from './base/pg-base.repository';

export interface ICandleRepository {
  findByRange(
    exchangeId: string,
    symbol: string,
    interval: string,
    from: Date,
    to: Date,
  ): Promise<Result<Candle[], DatabaseError>>;
  findLatest(
    exchangeId: string,
    symbol: string,
    interval: string,
    limit?: number,
  ): Promise<Result<Candle[], DatabaseError>>;
  findLastCandle(
    exchangeId: string,
    symbol: string,
    interval: string,
  ): Promise<Result<Candle | undefined, DatabaseError>>;
  save(candle: NewCandle, ctx?: AuditContext): Promise<Result<Candle, DatabaseError>>;
  saveMany(candles: NewCandle[], ctx?: AuditContext): Promise<Result<Candle[], DatabaseError>>;
  upsertMany(candles: NewCandle[], ctx?: AuditContext): Promise<Result<Candle[], DatabaseError>>;
  stream(
    exchangeId: string,
    symbol: string,
    interval: string,
    from: Date,
  ): AsyncIterableIterator<Candle>;
}

@Injectable()
export class CandleRepository extends PgBaseRepository<'candles'> implements ICandleRepository {
  protected readonly tableName = 'candles' as const;

  constructor(pool: PgPoolService, audit: AuditService) {
    super(pool, audit);
  }

  async findByRange(
    exchangeId: string,
    symbol: string,
    interval: string,
    from: Date,
    to: Date,
  ): Promise<Result<Candle[], DatabaseError>> {
    try {
      const rows = await this.db
        .selectFrom('candles')
        .selectAll()
        .where('exchange_id', '=', exchangeId)
        .where('symbol', '=', symbol)
        .where('interval', '=', interval)
        .where('open_time', '>=', from)
        .where('open_time', '<=', to)
        .orderBy('open_time', 'asc')
        .execute();
      return ok(rows);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  async findLatest(
    exchangeId: string,
    symbol: string,
    interval: string,
    limit = 100,
  ): Promise<Result<Candle[], DatabaseError>> {
    try {
      const rows = await this.db
        .selectFrom('candles')
        .selectAll()
        .where('exchange_id', '=', exchangeId)
        .where('symbol', '=', symbol)
        .where('interval', '=', interval)
        .orderBy('open_time', 'desc')
        .limit(limit)
        .execute();
      return ok(rows.reverse());
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  async findLastCandle(
    exchangeId: string,
    symbol: string,
    interval: string,
  ): Promise<Result<Candle | undefined, DatabaseError>> {
    try {
      const row = await this.db
        .selectFrom('candles')
        .selectAll()
        .where('exchange_id', '=', exchangeId)
        .where('symbol', '=', symbol)
        .where('interval', '=', interval)
        .orderBy('open_time', 'desc')
        .limit(1)
        .executeTakeFirst();
      return ok(row);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  save(candle: NewCandle, ctx?: AuditContext) {
    return this._insert(candle as Record<string, unknown>, ctx) as unknown as Promise<
      Result<Candle, DatabaseError>
    >;
  }

  saveMany(candles: NewCandle[], ctx?: AuditContext) {
    return this._insertMany(candles as Record<string, unknown>[], ctx) as unknown as Promise<
      Result<Candle[], DatabaseError>
    >;
  }

  async upsertMany(
    candles: NewCandle[],
    _ctx?: AuditContext,
  ): Promise<Result<Candle[], DatabaseError>> {
    if (candles.length === 0) return ok([]);
    try {
      const rows = await this.db
        .insertInto('candles')
        .values(candles as never)
        .onConflict((oc) =>
          oc.constraint('uq_candles_exchange_symbol_interval_time').doUpdateSet((eb) => ({
            high: eb.ref('excluded.high'),
            low: eb.ref('excluded.low'),
            close: eb.ref('excluded.close'),
            volume: eb.ref('excluded.volume'),
            quote_volume: eb.ref('excluded.quote_volume'),
            trade_count: eb.ref('excluded.trade_count'),
            is_final: eb.ref('excluded.is_final'),
          })),
        )
        .returningAll()
        .execute();

      return ok(rows as Candle[]);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  stream(
    exchangeId: string,
    symbol: string,
    interval: string,
    from: Date,
  ): AsyncIterableIterator<Candle> {
    return this.db
      .selectFrom('candles')
      .selectAll()
      .where('exchange_id', '=', exchangeId)
      .where('symbol', '=', symbol)
      .where('interval', '=', interval)
      .where('open_time', '>=', from)
      .orderBy('open_time', 'asc')
      .stream() as AsyncIterableIterator<Candle>;
  }
}
