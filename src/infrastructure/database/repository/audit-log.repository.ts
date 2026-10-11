import { Injectable } from '@nestjs/common';
import { ok, err, Result } from '@common/result';
import { DatabaseError } from '@common/errors/infrastructure.error';
import { NotFoundError } from '@domain/errors/domain.error';
import { PgPoolService } from '../connection/pg-pool.service';
import { AuditService } from '../audit/audit.service';
import { AuditLog } from '../types/database.types';
import { PgBaseRepository } from './base/pg-base.repository';
import { PaginationParams, PaginatedResult } from '../query/pagination.types';

export interface IAuditLogRepository {
  findById(id: string): Promise<Result<AuditLog, NotFoundError | DatabaseError>>;
  findByRecord(tableName: string, recordId: string): Promise<Result<AuditLog[], DatabaseError>>;
  findByActor(
    actor: string,
    pagination?: PaginationParams,
  ): Promise<Result<AuditLog[], DatabaseError>>;
  findByCorrelation(correlationId: string): Promise<Result<AuditLog[], DatabaseError>>;
  findByTimeRange(
    from: Date,
    to: Date,
    pagination?: PaginationParams,
  ): Promise<Result<AuditLog[], DatabaseError>>;
  list(pagination: PaginationParams): Promise<Result<PaginatedResult<AuditLog>, DatabaseError>>;
}

@Injectable()
export class AuditLogRepository
  extends PgBaseRepository<'audit_logs'>
  implements IAuditLogRepository
{
  protected readonly tableName = 'audit_logs' as const;

  constructor(pool: PgPoolService, audit: AuditService) {
    super(pool, audit);
  }

  findById(id: string) {
    return this._findById(id) as unknown as Promise<
      Result<AuditLog, NotFoundError | DatabaseError>
    >;
  }

  async findByRecord(
    tableName: string,
    recordId: string,
  ): Promise<Result<AuditLog[], DatabaseError>> {
    try {
      const rows = await this.db
        .selectFrom('audit_logs')
        .selectAll()
        .where('table_name', '=', tableName)
        .where('record_id', '=', recordId)
        .orderBy('created_at', 'asc')
        .execute();
      return ok(rows);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  async findByActor(
    actor: string,
    pagination?: PaginationParams,
  ): Promise<Result<AuditLog[], DatabaseError>> {
    try {
      let qb = this.db
        .selectFrom('audit_logs')
        .selectAll()
        .where('actor', '=', actor)
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

  async findByCorrelation(correlationId: string): Promise<Result<AuditLog[], DatabaseError>> {
    try {
      const rows = await this.db
        .selectFrom('audit_logs')
        .selectAll()
        .where('correlation_id', '=', correlationId)
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
  ): Promise<Result<AuditLog[], DatabaseError>> {
    try {
      let qb = this.db
        .selectFrom('audit_logs')
        .selectAll()
        .where('created_at', '>=', from)
        .where('created_at', '<=', to)
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
      Result<PaginatedResult<AuditLog>, DatabaseError>
    >;
  }
}
