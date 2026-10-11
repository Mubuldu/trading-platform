import { Injectable } from '@nestjs/common';
import { ok, err, Result } from '@common/result';
import { DatabaseError } from '@common/errors/infrastructure.error';
import { NotFoundError } from '@domain/errors/domain.error';
import { PgPoolService } from '../connection/pg-pool.service';
import { AuditService } from '../audit/audit.service';
import { AuditContext } from '../audit/audit-event.types';
import { Position, NewPosition, PositionUpdate } from '../types/database.types';
import { PgBaseRepository } from './base/pg-base.repository';
import { PaginationParams, PaginatedResult } from '../query/pagination.types';

export interface IPositionRepository {
  findById(id: string): Promise<Result<Position, NotFoundError | DatabaseError>>;
  findOpenByAccount(accountId: string): Promise<Result<Position[], DatabaseError>>;
  findByAccountAndSymbol(
    accountId: string,
    symbol: string,
  ): Promise<Result<Position[], DatabaseError>>;
  findOpenBySymbol(symbol: string): Promise<Result<Position[], DatabaseError>>;
  save(position: NewPosition, ctx?: AuditContext): Promise<Result<Position, DatabaseError>>;
  update(
    id: string,
    values: PositionUpdate,
    ctx?: AuditContext,
  ): Promise<Result<Position, NotFoundError | DatabaseError>>;
  updateOptimistic(
    id: string,
    version: number,
    values: PositionUpdate,
    ctx?: AuditContext,
  ): Promise<Result<Position, NotFoundError | DatabaseError>>;
  close(id: string, ctx?: AuditContext): Promise<Result<Position, NotFoundError | DatabaseError>>;
  delete(id: string, ctx?: AuditContext): Promise<Result<void, NotFoundError | DatabaseError>>;
  list(pagination: PaginationParams): Promise<Result<PaginatedResult<Position>, DatabaseError>>;
}

@Injectable()
export class PositionRepository
  extends PgBaseRepository<'positions'>
  implements IPositionRepository
{
  protected readonly tableName = 'positions' as const;

  constructor(pool: PgPoolService, audit: AuditService) {
    super(pool, audit);
  }

  findById(id: string) {
    return this._findById(id) as unknown as Promise<
      Result<Position, NotFoundError | DatabaseError>
    >;
  }

  async findOpenByAccount(accountId: string): Promise<Result<Position[], DatabaseError>> {
    try {
      const rows = await this.db
        .selectFrom('positions')
        .selectAll()
        .where('account_id', '=', accountId)
        .where('status', '=', 'open')
        .where('deleted_at', 'is', null)
        .execute();
      return ok(rows);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  async findByAccountAndSymbol(
    accountId: string,
    symbol: string,
  ): Promise<Result<Position[], DatabaseError>> {
    try {
      const rows = await this.db
        .selectFrom('positions')
        .selectAll()
        .where('account_id', '=', accountId)
        .where('symbol', '=', symbol)
        .where('deleted_at', 'is', null)
        .orderBy('created_at', 'desc')
        .execute();
      return ok(rows);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  async findOpenBySymbol(symbol: string): Promise<Result<Position[], DatabaseError>> {
    try {
      const rows = await this.db
        .selectFrom('positions')
        .selectAll()
        .where('symbol', '=', symbol)
        .where('status', '=', 'open')
        .where('deleted_at', 'is', null)
        .execute();
      return ok(rows);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  save(position: NewPosition, ctx?: AuditContext) {
    return this._insert(position as Record<string, unknown>, ctx) as unknown as Promise<
      Result<Position, DatabaseError>
    >;
  }

  update(id: string, values: PositionUpdate, ctx?: AuditContext) {
    return this._update(id, values as Record<string, unknown>, ctx) as unknown as Promise<
      Result<Position, NotFoundError | DatabaseError>
    >;
  }

  updateOptimistic(id: string, version: number, values: PositionUpdate, ctx?: AuditContext) {
    return this._updateWithVersion(
      id,
      version,
      values as Record<string, unknown>,
      ctx,
    ) as unknown as Promise<Result<Position, NotFoundError | DatabaseError>>;
  }

  async close(
    id: string,
    ctx?: AuditContext,
  ): Promise<Result<Position, NotFoundError | DatabaseError>> {
    return this.update(id, { status: 'closed' } as PositionUpdate, ctx);
  }

  delete(id: string, ctx?: AuditContext) {
    return this._softDelete(id, ctx);
  }

  list(pagination: PaginationParams) {
    return this._findAllPaginated(pagination) as unknown as Promise<
      Result<PaginatedResult<Position>, DatabaseError>
    >;
  }
}
