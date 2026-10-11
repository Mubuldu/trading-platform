import { Injectable } from '@nestjs/common';
import { ok, err, Result } from '@common/result';
import { DatabaseError } from '@common/errors/infrastructure.error';
import { NotFoundError } from '@domain/errors/domain.error';
import { PgPoolService } from '../connection/pg-pool.service';
import { AuditService } from '../audit/audit.service';
import { AuditContext } from '../audit/audit-event.types';
import { Fill, NewFill } from '../types/database.types';
import { PgBaseRepository } from './base/pg-base.repository';
import { PaginationParams, PaginatedResult } from '../query/pagination.types';

export interface IFillRepository {
  findById(id: string): Promise<Result<Fill, NotFoundError | DatabaseError>>;
  findByOrder(orderId: string): Promise<Result<Fill[], DatabaseError>>;
  findByAccount(
    accountId: string,
    pagination?: PaginationParams,
  ): Promise<Result<Fill[], DatabaseError>>;
  findByAccountAndSymbol(
    accountId: string,
    symbol: string,
    from?: Date,
    to?: Date,
  ): Promise<Result<Fill[], DatabaseError>>;
  save(fill: NewFill, ctx?: AuditContext): Promise<Result<Fill, DatabaseError>>;
  saveMany(fills: NewFill[], ctx?: AuditContext): Promise<Result<Fill[], DatabaseError>>;
  delete(id: string, ctx?: AuditContext): Promise<Result<void, NotFoundError | DatabaseError>>;
  list(pagination: PaginationParams): Promise<Result<PaginatedResult<Fill>, DatabaseError>>;
}

@Injectable()
export class FillRepository extends PgBaseRepository<'fills'> implements IFillRepository {
  protected readonly tableName = 'fills' as const;

  constructor(pool: PgPoolService, audit: AuditService) {
    super(pool, audit);
  }

  findById(id: string) {
    return this._findById(id) as unknown as Promise<Result<Fill, NotFoundError | DatabaseError>>;
  }

  async findByOrder(orderId: string): Promise<Result<Fill[], DatabaseError>> {
    try {
      const rows = await this.db
        .selectFrom('fills')
        .selectAll()
        .where('order_id', '=', orderId)
        .where('deleted_at', 'is', null)
        .orderBy('fill_time', 'asc')
        .execute();
      return ok(rows);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  async findByAccount(
    accountId: string,
    pagination?: PaginationParams,
  ): Promise<Result<Fill[], DatabaseError>> {
    try {
      let qb = this.db
        .selectFrom('fills')
        .selectAll()
        .where('account_id', '=', accountId)
        .where('deleted_at', 'is', null)
        .orderBy('fill_time', 'desc');

      if (pagination) {
        const offset = (pagination.page - 1) * pagination.pageSize;
        qb = qb.offset(offset).limit(pagination.pageSize) as typeof qb;
      }

      const rows = await qb.execute();
      return ok(rows);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  async findByAccountAndSymbol(
    accountId: string,
    symbol: string,
    from?: Date,
    to?: Date,
  ): Promise<Result<Fill[], DatabaseError>> {
    try {
      let qb = this.db
        .selectFrom('fills')
        .selectAll()
        .where('account_id', '=', accountId)
        .where('symbol', '=', symbol)
        .where('deleted_at', 'is', null);

      if (from) qb = qb.where('fill_time', '>=', from) as typeof qb;
      if (to) qb = qb.where('fill_time', '<=', to) as typeof qb;

      const rows = await qb.orderBy('fill_time', 'desc').execute();
      return ok(rows);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  save(fill: NewFill, ctx?: AuditContext) {
    return this._insert(fill as Record<string, unknown>, ctx) as unknown as Promise<
      Result<Fill, DatabaseError>
    >;
  }

  saveMany(fills: NewFill[], ctx?: AuditContext) {
    return this._insertMany(fills as Record<string, unknown>[], ctx) as unknown as Promise<
      Result<Fill[], DatabaseError>
    >;
  }

  delete(id: string, ctx?: AuditContext) {
    return this._softDelete(id, ctx);
  }

  list(pagination: PaginationParams) {
    return this._findAllPaginated(pagination) as unknown as Promise<
      Result<PaginatedResult<Fill>, DatabaseError>
    >;
  }
}
