import { Injectable } from '@nestjs/common';
import { ok, err, Result } from '@common/result';
import { DatabaseError } from '@common/errors/infrastructure.error';
import { PgPoolService } from '../connection/pg-pool.service';
import { AuditService } from '../audit/audit.service';
import { SystemLog, NewSystemLog } from '../types/database.types';
import { PgBaseRepository } from './base/pg-base.repository';
import { PaginationParams, PaginatedResult } from '../query/pagination.types';

export interface ISystemLogRepository {
  save(log: NewSystemLog): Promise<Result<SystemLog, DatabaseError>>;
  saveMany(logs: NewSystemLog[]): Promise<Result<SystemLog[], DatabaseError>>;
  findByLevel(
    level: string,
    pagination?: PaginationParams,
  ): Promise<Result<SystemLog[], DatabaseError>>;
  findByCorrelation(correlationId: string): Promise<Result<SystemLog[], DatabaseError>>;
  findByTimeRange(
    from: Date,
    to: Date,
    pagination?: PaginationParams,
  ): Promise<Result<SystemLog[], DatabaseError>>;
  list(pagination: PaginationParams): Promise<Result<PaginatedResult<SystemLog>, DatabaseError>>;
}

@Injectable()
export class SystemLogRepository
  extends PgBaseRepository<'system_logs'>
  implements ISystemLogRepository
{
  protected readonly tableName = 'system_logs' as const;

  constructor(pool: PgPoolService, audit: AuditService) {
    super(pool, audit);
  }

  save(log: NewSystemLog) {
    return this._insert(log as Record<string, unknown>) as unknown as Promise<
      Result<SystemLog, DatabaseError>
    >;
  }

  saveMany(logs: NewSystemLog[]) {
    return this._insertMany(logs as Record<string, unknown>[]) as unknown as Promise<
      Result<SystemLog[], DatabaseError>
    >;
  }

  async findByLevel(
    level: string,
    pagination?: PaginationParams,
  ): Promise<Result<SystemLog[], DatabaseError>> {
    try {
      let qb = this.db
        .selectFrom('system_logs')
        .selectAll()
        .where('level', '=', level)
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

  async findByCorrelation(correlationId: string): Promise<Result<SystemLog[], DatabaseError>> {
    try {
      const rows = await this.db
        .selectFrom('system_logs')
        .selectAll()
        .where('correlation_id', '=', correlationId)
        .where('deleted_at', 'is', null)
        .orderBy('created_at', 'asc')
        .execute();
      return ok(rows);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  async findByTimeRange(
    from: Date,
    to: Date,
    pagination?: PaginationParams,
  ): Promise<Result<SystemLog[], DatabaseError>> {
    try {
      let qb = this.db
        .selectFrom('system_logs')
        .selectAll()
        .where('created_at', '>=', from)
        .where('created_at', '<=', to)
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

  list(pagination: PaginationParams) {
    return this._findAllPaginated(pagination) as unknown as Promise<
      Result<PaginatedResult<SystemLog>, DatabaseError>
    >;
  }
}
