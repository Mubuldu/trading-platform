import { Injectable } from '@nestjs/common';
import { ok, err, Result } from '@common/result';
import { DatabaseError } from '@common/errors/infrastructure.error';
import { NotFoundError } from '@domain/errors/domain.error';
import { PgPoolService } from '../connection/pg-pool.service';
import { AuditService } from '../audit/audit.service';
import { AuditContext } from '../audit/audit-event.types';
import { Execution, NewExecution } from '../types/database.types';
import { PgBaseRepository } from './base/pg-base.repository';
import { PaginationParams, PaginatedResult } from '../query/pagination.types';

export interface IExecutionRepository {
  findById(id: string): Promise<Result<Execution, NotFoundError | DatabaseError>>;
  findByOrder(orderId: string): Promise<Result<Execution[], DatabaseError>>;
  findByExchangeOrder(
    exchangeId: string,
    exchangeOrderId: string,
  ): Promise<Result<Execution[], DatabaseError>>;
  findByAccount(
    accountId: string,
    pagination?: PaginationParams,
  ): Promise<Result<Execution[], DatabaseError>>;
  save(execution: NewExecution, ctx?: AuditContext): Promise<Result<Execution, DatabaseError>>;
  saveMany(
    executions: NewExecution[],
    ctx?: AuditContext,
  ): Promise<Result<Execution[], DatabaseError>>;
  delete(id: string, ctx?: AuditContext): Promise<Result<void, NotFoundError | DatabaseError>>;
  list(pagination: PaginationParams): Promise<Result<PaginatedResult<Execution>, DatabaseError>>;
}

@Injectable()
export class ExecutionRepository
  extends PgBaseRepository<'executions'>
  implements IExecutionRepository
{
  protected readonly tableName = 'executions' as const;

  constructor(pool: PgPoolService, audit: AuditService) {
    super(pool, audit);
  }

  findById(id: string) {
    return this._findById(id) as unknown as Promise<
      Result<Execution, NotFoundError | DatabaseError>
    >;
  }

  async findByOrder(orderId: string): Promise<Result<Execution[], DatabaseError>> {
    try {
      const rows = await this.db
        .selectFrom('executions')
        .selectAll()
        .where('order_id', '=', orderId)
        .where('deleted_at', 'is', null)
        .orderBy('created_at', 'asc')
        .execute();
      return ok(rows);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  async findByExchangeOrder(
    exchangeId: string,
    exchangeOrderId: string,
  ): Promise<Result<Execution[], DatabaseError>> {
    try {
      const rows = await this.db
        .selectFrom('executions')
        .selectAll()
        .where('exchange_id', '=', exchangeId)
        .where('exchange_order_id', '=', exchangeOrderId)
        .orderBy('created_at', 'asc')
        .execute();
      return ok(rows);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  async findByAccount(
    accountId: string,
    pagination?: PaginationParams,
  ): Promise<Result<Execution[], DatabaseError>> {
    try {
      let qb = this.db
        .selectFrom('executions')
        .selectAll()
        .where('account_id', '=', accountId)
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

  save(execution: NewExecution, ctx?: AuditContext) {
    return this._insert(execution as Record<string, unknown>, ctx) as unknown as Promise<
      Result<Execution, DatabaseError>
    >;
  }

  saveMany(executions: NewExecution[], ctx?: AuditContext) {
    return this._insertMany(executions as Record<string, unknown>[], ctx) as unknown as Promise<
      Result<Execution[], DatabaseError>
    >;
  }

  delete(id: string, ctx?: AuditContext) {
    return this._softDelete(id, ctx);
  }

  list(pagination: PaginationParams) {
    return this._findAllPaginated(pagination) as unknown as Promise<
      Result<PaginatedResult<Execution>, DatabaseError>
    >;
  }
}
