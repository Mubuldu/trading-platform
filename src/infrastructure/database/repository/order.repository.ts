import { Injectable } from '@nestjs/common';
import { ok, err, Result } from '@common/result';
import { DatabaseError } from '@common/errors/infrastructure.error';
import { NotFoundError } from '@domain/errors/domain.error';
import { PgPoolService } from '../connection/pg-pool.service';
import { AuditService } from '../audit/audit.service';
import { AuditContext } from '../audit/audit-event.types';
import { Order, NewOrder, OrderUpdate } from '../types/database.types';
import { PgBaseRepository } from './base/pg-base.repository';
import { PaginationParams, PaginatedResult } from '../query/pagination.types';

export interface IOrderRepository {
  findById(id: string): Promise<Result<Order, NotFoundError | DatabaseError>>;
  findByExchangeOrderId(
    exchangeId: string,
    exchangeOrderId: string,
  ): Promise<Result<Order | undefined, DatabaseError>>;
  findByClientOrderId(clientOrderId: string): Promise<Result<Order | undefined, DatabaseError>>;
  findByAccount(
    accountId: string,
    pagination?: PaginationParams,
  ): Promise<Result<Order[], DatabaseError>>;
  findByAccountAndSymbol(
    accountId: string,
    symbol: string,
    pagination?: PaginationParams,
  ): Promise<Result<Order[], DatabaseError>>;
  findOpenByAccount(accountId: string): Promise<Result<Order[], DatabaseError>>;
  save(order: NewOrder, ctx?: AuditContext): Promise<Result<Order, DatabaseError>>;
  update(
    id: string,
    values: OrderUpdate,
    ctx?: AuditContext,
  ): Promise<Result<Order, NotFoundError | DatabaseError>>;
  updateOptimistic(
    id: string,
    version: number,
    values: OrderUpdate,
    ctx?: AuditContext,
  ): Promise<Result<Order, NotFoundError | DatabaseError>>;
  delete(id: string, ctx?: AuditContext): Promise<Result<void, NotFoundError | DatabaseError>>;
  list(pagination: PaginationParams): Promise<Result<PaginatedResult<Order>, DatabaseError>>;
}

@Injectable()
export class OrderRepository extends PgBaseRepository<'orders'> implements IOrderRepository {
  protected readonly tableName = 'orders' as const;

  constructor(pool: PgPoolService, audit: AuditService) {
    super(pool, audit);
  }

  findById(id: string) {
    return this._findById(id) as unknown as Promise<Result<Order, NotFoundError | DatabaseError>>;
  }

  async findByExchangeOrderId(
    exchangeId: string,
    exchangeOrderId: string,
  ): Promise<Result<Order | undefined, DatabaseError>> {
    try {
      const row = await this.db
        .selectFrom('orders')
        .selectAll()
        .where('exchange_id', '=', exchangeId)
        .where('exchange_order_id', '=', exchangeOrderId)
        .executeTakeFirst();
      return ok(row);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  async findByClientOrderId(
    clientOrderId: string,
  ): Promise<Result<Order | undefined, DatabaseError>> {
    try {
      const row = await this.db
        .selectFrom('orders')
        .selectAll()
        .where('client_order_id', '=', clientOrderId)
        .executeTakeFirst();
      return ok(row);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  async findByAccount(
    accountId: string,
    pagination?: PaginationParams,
  ): Promise<Result<Order[], DatabaseError>> {
    try {
      let qb = this.db
        .selectFrom('orders')
        .selectAll()
        .where('account_id', '=', accountId)
        .where('deleted_at', 'is', null)
        .orderBy('created_at', 'desc');

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
    pagination?: PaginationParams,
  ): Promise<Result<Order[], DatabaseError>> {
    try {
      let qb = this.db
        .selectFrom('orders')
        .selectAll()
        .where('account_id', '=', accountId)
        .where('symbol', '=', symbol)
        .where('deleted_at', 'is', null)
        .orderBy('created_at', 'desc');

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

  async findOpenByAccount(accountId: string): Promise<Result<Order[], DatabaseError>> {
    try {
      const rows = await this.db
        .selectFrom('orders')
        .selectAll()
        .where('account_id', '=', accountId)
        .where('status', 'in', ['NEW', 'PARTIALLY_FILLED', 'PENDING_CANCEL'])
        .where('deleted_at', 'is', null)
        .orderBy('created_at', 'desc')
        .execute();
      return ok(rows);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  save(order: NewOrder, ctx?: AuditContext) {
    return this._insert(order as Record<string, unknown>, ctx) as unknown as Promise<
      Result<Order, DatabaseError>
    >;
  }

  update(id: string, values: OrderUpdate, ctx?: AuditContext) {
    return this._update(id, values as Record<string, unknown>, ctx) as unknown as Promise<
      Result<Order, NotFoundError | DatabaseError>
    >;
  }

  updateOptimistic(id: string, version: number, values: OrderUpdate, ctx?: AuditContext) {
    return this._updateWithVersion(
      id,
      version,
      values as Record<string, unknown>,
      ctx,
    ) as unknown as Promise<Result<Order, NotFoundError | DatabaseError>>;
  }

  delete(id: string, ctx?: AuditContext) {
    return this._softDelete(id, ctx);
  }

  list(pagination: PaginationParams) {
    return this._findAllPaginated(pagination) as unknown as Promise<
      Result<PaginatedResult<Order>, DatabaseError>
    >;
  }
}
