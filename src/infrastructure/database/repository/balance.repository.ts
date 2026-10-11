import { Injectable } from '@nestjs/common';
import { ok, err, Result } from '@common/result';
import { DatabaseError } from '@common/errors/infrastructure.error';
import { PgPoolService } from '../connection/pg-pool.service';
import { AuditService } from '../audit/audit.service';
import { AuditContext } from '../audit/audit-event.types';
import { Balance, NewBalance } from '../types/database.types';
import { PgBaseRepository } from './base/pg-base.repository';
import { PaginationParams, PaginatedResult } from '../query/pagination.types';

export interface IBalanceRepository {
  save(balance: NewBalance, ctx?: AuditContext): Promise<Result<Balance, DatabaseError>>;
  saveMany(balances: NewBalance[], ctx?: AuditContext): Promise<Result<Balance[], DatabaseError>>;
  findByAccount(accountId: string): Promise<Result<Balance[], DatabaseError>>;
  findByAccountAndAsset(
    accountId: string,
    asset: string,
  ): Promise<Result<Balance[], DatabaseError>>;
  findLatestSnapshot(accountId: string): Promise<Result<Balance[], DatabaseError>>;
  list(pagination: PaginationParams): Promise<Result<PaginatedResult<Balance>, DatabaseError>>;
}

@Injectable()
export class BalanceRepository extends PgBaseRepository<'balances'> implements IBalanceRepository {
  protected readonly tableName = 'balances' as const;

  constructor(pool: PgPoolService, audit: AuditService) {
    super(pool, audit);
  }

  save(balance: NewBalance, ctx?: AuditContext) {
    return this._insert(balance as Record<string, unknown>, ctx) as unknown as Promise<
      Result<Balance, DatabaseError>
    >;
  }

  saveMany(balances: NewBalance[], ctx?: AuditContext) {
    return this._insertMany(balances as Record<string, unknown>[], ctx) as unknown as Promise<
      Result<Balance[], DatabaseError>
    >;
  }

  async findByAccount(accountId: string): Promise<Result<Balance[], DatabaseError>> {
    try {
      const rows = await this.db
        .selectFrom('balances')
        .selectAll()
        .where('account_id', '=', accountId)
        .orderBy('snapshot_at', 'desc')
        .execute();
      return ok(rows);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  async findByAccountAndAsset(
    accountId: string,
    asset: string,
  ): Promise<Result<Balance[], DatabaseError>> {
    try {
      const rows = await this.db
        .selectFrom('balances')
        .selectAll()
        .where('account_id', '=', accountId)
        .where('asset', '=', asset)
        .orderBy('snapshot_at', 'desc')
        .execute();
      return ok(rows);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  async findLatestSnapshot(accountId: string): Promise<Result<Balance[], DatabaseError>> {
    try {
      // Subquery: latest snapshot_at per asset for this account
      const rows = await this.db
        .selectFrom('balances as b')
        .selectAll('b')
        .innerJoin(
          this.db
            .selectFrom('balances')
            .select(['asset', (eb) => eb.fn.max('snapshot_at').as('max_at')])
            .where('account_id', '=', accountId)
            .groupBy('asset')
            .as('latest'),
          (join) =>
            join.onRef('b.asset', '=', 'latest.asset').onRef('b.snapshot_at', '=', 'latest.max_at'),
        )
        .where('b.account_id', '=', accountId)
        .execute();
      return ok(rows);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  list(pagination: PaginationParams) {
    return this._findAllPaginated(pagination) as unknown as Promise<
      Result<PaginatedResult<Balance>, DatabaseError>
    >;
  }
}
