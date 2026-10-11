import { Injectable } from '@nestjs/common';
import { ok, err, Result } from '@common/result';
import { DatabaseError } from '@common/errors/infrastructure.error';
import { NotFoundError } from '@domain/errors/domain.error';
import { PgPoolService } from '../connection/pg-pool.service';
import { AuditService } from '../audit/audit.service';
import { AuditContext } from '../audit/audit-event.types';
import { Account, NewAccount, AccountUpdate } from '../types/database.types';
import { PgBaseRepository } from './base/pg-base.repository';
import { PaginationParams, PaginatedResult } from '../query/pagination.types';

export interface IAccountRepository {
  findById(id: string): Promise<Result<Account, NotFoundError | DatabaseError>>;
  findByExchangeId(exchangeId: string): Promise<Result<Account[], DatabaseError>>;
  findActive(): Promise<Result<Account[], DatabaseError>>;
  save(account: NewAccount, ctx?: AuditContext): Promise<Result<Account, DatabaseError>>;
  update(
    id: string,
    values: AccountUpdate,
    ctx?: AuditContext,
  ): Promise<Result<Account, NotFoundError | DatabaseError>>;
  updateOptimistic(
    id: string,
    version: number,
    values: AccountUpdate,
    ctx?: AuditContext,
  ): Promise<Result<Account, NotFoundError | DatabaseError>>;
  delete(id: string, ctx?: AuditContext): Promise<Result<void, NotFoundError | DatabaseError>>;
  list(pagination: PaginationParams): Promise<Result<PaginatedResult<Account>, DatabaseError>>;
}

@Injectable()
export class AccountRepository extends PgBaseRepository<'accounts'> implements IAccountRepository {
  protected readonly tableName = 'accounts' as const;

  constructor(pool: PgPoolService, audit: AuditService) {
    super(pool, audit);
  }

  findById(id: string) {
    return this._findById(id) as unknown as Promise<Result<Account, NotFoundError | DatabaseError>>;
  }

  async findByExchangeId(exchangeId: string): Promise<Result<Account[], DatabaseError>> {
    try {
      const rows = await this.db
        .selectFrom('accounts')
        .selectAll()
        .where('exchange_id', '=', exchangeId)
        .where('deleted_at', 'is', null)
        .execute();
      return ok(rows);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  async findActive(): Promise<Result<Account[], DatabaseError>> {
    try {
      const rows = await this.db
        .selectFrom('accounts')
        .selectAll()
        .where('status', '=', 'active')
        .where('deleted_at', 'is', null)
        .execute();
      return ok(rows);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  save(account: NewAccount, ctx?: AuditContext) {
    return this._insert(account as Record<string, unknown>, ctx) as unknown as Promise<
      Result<Account, DatabaseError>
    >;
  }

  update(id: string, values: AccountUpdate, ctx?: AuditContext) {
    return this._update(id, values as Record<string, unknown>, ctx) as unknown as Promise<
      Result<Account, NotFoundError | DatabaseError>
    >;
  }

  updateOptimistic(id: string, version: number, values: AccountUpdate, ctx?: AuditContext) {
    return this._updateWithVersion(
      id,
      version,
      values as Record<string, unknown>,
      ctx,
    ) as unknown as Promise<Result<Account, NotFoundError | DatabaseError>>;
  }

  delete(id: string, ctx?: AuditContext) {
    return this._softDelete(id, ctx);
  }

  list(pagination: PaginationParams) {
    return this._findAllPaginated(pagination) as unknown as Promise<
      Result<PaginatedResult<Account>, DatabaseError>
    >;
  }
}
