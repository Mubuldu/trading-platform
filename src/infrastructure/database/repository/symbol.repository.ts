import { Injectable } from '@nestjs/common';
import { ok, err, Result } from '@common/result';
import { DatabaseError } from '@common/errors/infrastructure.error';
import { NotFoundError } from '@domain/errors/domain.error';
import { PgPoolService } from '../connection/pg-pool.service';
import { AuditService } from '../audit/audit.service';
import { AuditContext } from '../audit/audit-event.types';
import { Symbol as DbSymbol, NewSymbol, SymbolUpdate } from '../types/database.types';
import { PgBaseRepository } from './base/pg-base.repository';

export interface ISymbolRepository {
  findById(id: string): Promise<Result<DbSymbol, NotFoundError | DatabaseError>>;
  findByExchangeAndSymbol(
    exchangeId: string,
    symbol: string,
  ): Promise<Result<DbSymbol | undefined, DatabaseError>>;
  findByExchange(exchangeId: string): Promise<Result<DbSymbol[], DatabaseError>>;
  findByBaseAndQuote(
    baseAsset: string,
    quoteAsset: string,
  ): Promise<Result<DbSymbol[], DatabaseError>>;
  findActive(): Promise<Result<DbSymbol[], DatabaseError>>;
  save(symbol: NewSymbol, ctx?: AuditContext): Promise<Result<DbSymbol, DatabaseError>>;
  saveMany(symbols: NewSymbol[], ctx?: AuditContext): Promise<Result<DbSymbol[], DatabaseError>>;
  update(
    id: string,
    values: SymbolUpdate,
    ctx?: AuditContext,
  ): Promise<Result<DbSymbol, NotFoundError | DatabaseError>>;
  upsert(symbol: NewSymbol, ctx?: AuditContext): Promise<Result<DbSymbol, DatabaseError>>;
}

@Injectable()
export class SymbolRepository extends PgBaseRepository<'symbols'> implements ISymbolRepository {
  protected readonly tableName = 'symbols' as const;

  constructor(pool: PgPoolService, audit: AuditService) {
    super(pool, audit);
  }

  findById(id: string) {
    return this._findById(id) as unknown as Promise<
      Result<DbSymbol, NotFoundError | DatabaseError>
    >;
  }

  async findByExchangeAndSymbol(
    exchangeId: string,
    symbol: string,
  ): Promise<Result<DbSymbol | undefined, DatabaseError>> {
    try {
      const row = await this.db
        .selectFrom('symbols')
        .selectAll()
        .where('exchange_id', '=', exchangeId)
        .where('symbol', '=', symbol)
        .executeTakeFirst();
      return ok(row);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  async findByExchange(exchangeId: string): Promise<Result<DbSymbol[], DatabaseError>> {
    try {
      const rows = await this.db
        .selectFrom('symbols')
        .selectAll()
        .where('exchange_id', '=', exchangeId)
        .orderBy('symbol', 'asc')
        .execute();
      return ok(rows);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  async findByBaseAndQuote(
    baseAsset: string,
    quoteAsset: string,
  ): Promise<Result<DbSymbol[], DatabaseError>> {
    try {
      const rows = await this.db
        .selectFrom('symbols')
        .selectAll()
        .where('base_asset', '=', baseAsset)
        .where('quote_asset', '=', quoteAsset)
        .execute();
      return ok(rows);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  async findActive(): Promise<Result<DbSymbol[], DatabaseError>> {
    try {
      const rows = await this.db
        .selectFrom('symbols')
        .selectAll()
        .where('status', '=', 'TRADING')
        .execute();
      return ok(rows);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  save(symbol: NewSymbol, ctx?: AuditContext) {
    return this._insert(symbol as Record<string, unknown>, ctx) as unknown as Promise<
      Result<DbSymbol, DatabaseError>
    >;
  }

  saveMany(symbols: NewSymbol[], ctx?: AuditContext) {
    return this._insertMany(symbols as Record<string, unknown>[], ctx) as unknown as Promise<
      Result<DbSymbol[], DatabaseError>
    >;
  }

  update(id: string, values: SymbolUpdate, ctx?: AuditContext) {
    return this._update(id, values as Record<string, unknown>, ctx) as unknown as Promise<
      Result<DbSymbol, NotFoundError | DatabaseError>
    >;
  }

  async upsert(symbol: NewSymbol, ctx?: AuditContext): Promise<Result<DbSymbol, DatabaseError>> {
    try {
      const row = await this.db
        .insertInto('symbols')
        .values(symbol as never)
        .onConflict((oc) =>
          oc.constraint('uq_symbols_exchange_symbol').doUpdateSet({
            status: symbol.status,
            min_quantity: symbol.min_quantity,
            max_quantity: symbol.max_quantity,
            step_size: symbol.step_size,
            min_notional: symbol.min_notional,
            tick_size: symbol.tick_size,
            updated_at: new Date(),
          } as never),
        )
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.audit.log({
        tableName: 'symbols',
        recordId: (row as { id: string }).id,
        operation: 'INSERT',
        newValue: row,
        ...ctx,
      });

      return ok(row as DbSymbol);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }
}
