import { Injectable } from '@nestjs/common';
import { ok, err, Result } from '@common/result';
import { DatabaseError } from '@common/errors/infrastructure.error';
import { NotFoundError } from '@domain/errors/domain.error';
import { PgPoolService } from '../connection/pg-pool.service';
import { AuditService } from '../audit/audit.service';
import { AuditContext } from '../audit/audit-event.types';
import { Strategy, NewStrategy, StrategyUpdate } from '../types/database.types';
import { PgBaseRepository } from './base/pg-base.repository';
import { PaginationParams, PaginatedResult } from '../query/pagination.types';

export type StrategyStatus = 'active' | 'paused' | 'stopped' | 'error';

export interface IStrategyRepository {
  findById(id: string): Promise<Result<Strategy, NotFoundError | DatabaseError>>;
  findByAccount(accountId: string): Promise<Result<Strategy[], DatabaseError>>;
  findByStatus(status: StrategyStatus): Promise<Result<Strategy[], DatabaseError>>;
  findActive(): Promise<Result<Strategy[], DatabaseError>>;
  save(strategy: NewStrategy, ctx?: AuditContext): Promise<Result<Strategy, DatabaseError>>;
  update(
    id: string,
    values: StrategyUpdate,
    ctx?: AuditContext,
  ): Promise<Result<Strategy, NotFoundError | DatabaseError>>;
  updateOptimistic(
    id: string,
    version: number,
    values: StrategyUpdate,
    ctx?: AuditContext,
  ): Promise<Result<Strategy, NotFoundError | DatabaseError>>;
  delete(id: string, ctx?: AuditContext): Promise<Result<void, NotFoundError | DatabaseError>>;
  list(pagination: PaginationParams): Promise<Result<PaginatedResult<Strategy>, DatabaseError>>;
}

@Injectable()
export class StrategyRepository
  extends PgBaseRepository<'strategies'>
  implements IStrategyRepository
{
  protected readonly tableName = 'strategies' as const;

  constructor(pool: PgPoolService, audit: AuditService) {
    super(pool, audit);
  }

  findById(id: string) {
    return this._findById(id) as unknown as Promise<
      Result<Strategy, NotFoundError | DatabaseError>
    >;
  }

  async findByAccount(accountId: string): Promise<Result<Strategy[], DatabaseError>> {
    try {
      const rows = await this.db
        .selectFrom('strategies')
        .selectAll()
        .where('account_id', '=', accountId)
        .where('deleted_at', 'is', null)
        .orderBy('created_at', 'desc')
        .execute();
      return ok(rows);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  async findByStatus(status: StrategyStatus): Promise<Result<Strategy[], DatabaseError>> {
    try {
      const rows = await this.db
        .selectFrom('strategies')
        .selectAll()
        .where('status', '=', status)
        .where('deleted_at', 'is', null)
        .execute();
      return ok(rows);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  async findActive(): Promise<Result<Strategy[], DatabaseError>> {
    return this.findByStatus('active');
  }

  save(strategy: NewStrategy, ctx?: AuditContext) {
    return this._insert(strategy as Record<string, unknown>, ctx) as unknown as Promise<
      Result<Strategy, DatabaseError>
    >;
  }

  update(id: string, values: StrategyUpdate, ctx?: AuditContext) {
    return this._update(id, values as Record<string, unknown>, ctx) as unknown as Promise<
      Result<Strategy, NotFoundError | DatabaseError>
    >;
  }

  updateOptimistic(id: string, version: number, values: StrategyUpdate, ctx?: AuditContext) {
    return this._updateWithVersion(
      id,
      version,
      values as Record<string, unknown>,
      ctx,
    ) as unknown as Promise<Result<Strategy, NotFoundError | DatabaseError>>;
  }

  delete(id: string, ctx?: AuditContext) {
    return this._softDelete(id, ctx);
  }

  list(pagination: PaginationParams) {
    return this._findAllPaginated(pagination) as unknown as Promise<
      Result<PaginatedResult<Strategy>, DatabaseError>
    >;
  }
}
