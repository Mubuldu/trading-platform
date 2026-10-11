import { Injectable } from '@nestjs/common';
import { ok, err, Result } from '@common/result';
import { DatabaseError } from '@common/errors/infrastructure.error';
import { NotFoundError } from '@domain/errors/domain.error';
import { PgPoolService } from '../connection/pg-pool.service';
import { AuditService } from '../audit/audit.service';
import { AuditContext } from '../audit/audit-event.types';
import { RiskProfile, NewRiskProfile, RiskProfileUpdate } from '../types/database.types';
import { PgBaseRepository } from './base/pg-base.repository';

export interface IRiskProfileRepository {
  findById(id: string): Promise<Result<RiskProfile, NotFoundError | DatabaseError>>;
  findByAccount(accountId: string): Promise<Result<RiskProfile[], DatabaseError>>;
  findByStrategy(strategyId: string): Promise<Result<RiskProfile | undefined, DatabaseError>>;
  findActive(): Promise<Result<RiskProfile[], DatabaseError>>;
  save(profile: NewRiskProfile, ctx?: AuditContext): Promise<Result<RiskProfile, DatabaseError>>;
  update(
    id: string,
    values: RiskProfileUpdate,
    ctx?: AuditContext,
  ): Promise<Result<RiskProfile, NotFoundError | DatabaseError>>;
  updateOptimistic(
    id: string,
    version: number,
    values: RiskProfileUpdate,
    ctx?: AuditContext,
  ): Promise<Result<RiskProfile, NotFoundError | DatabaseError>>;
  delete(id: string, ctx?: AuditContext): Promise<Result<void, NotFoundError | DatabaseError>>;
}

@Injectable()
export class RiskProfileRepository
  extends PgBaseRepository<'risk_profiles'>
  implements IRiskProfileRepository
{
  protected readonly tableName = 'risk_profiles' as const;

  constructor(pool: PgPoolService, audit: AuditService) {
    super(pool, audit);
  }

  findById(id: string) {
    return this._findById(id) as unknown as Promise<
      Result<RiskProfile, NotFoundError | DatabaseError>
    >;
  }

  async findByAccount(accountId: string): Promise<Result<RiskProfile[], DatabaseError>> {
    try {
      const rows = await this.db
        .selectFrom('risk_profiles')
        .selectAll()
        .where('account_id', '=', accountId)
        .where('deleted_at', 'is', null)
        .execute();
      return ok(rows);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  async findByStrategy(
    strategyId: string,
  ): Promise<Result<RiskProfile | undefined, DatabaseError>> {
    try {
      const row = await this.db
        .selectFrom('risk_profiles')
        .selectAll()
        .where('strategy_id', '=', strategyId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      return ok(row);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  async findActive(): Promise<Result<RiskProfile[], DatabaseError>> {
    try {
      const rows = await this.db
        .selectFrom('risk_profiles')
        .selectAll()
        .where('status', '=', 'active')
        .where('deleted_at', 'is', null)
        .execute();
      return ok(rows);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  save(profile: NewRiskProfile, ctx?: AuditContext) {
    return this._insert(profile as Record<string, unknown>, ctx) as unknown as Promise<
      Result<RiskProfile, DatabaseError>
    >;
  }

  update(id: string, values: RiskProfileUpdate, ctx?: AuditContext) {
    return this._update(id, values as Record<string, unknown>, ctx) as unknown as Promise<
      Result<RiskProfile, NotFoundError | DatabaseError>
    >;
  }

  updateOptimistic(id: string, version: number, values: RiskProfileUpdate, ctx?: AuditContext) {
    return this._updateWithVersion(
      id,
      version,
      values as Record<string, unknown>,
      ctx,
    ) as unknown as Promise<Result<RiskProfile, NotFoundError | DatabaseError>>;
  }

  delete(id: string, ctx?: AuditContext) {
    return this._softDelete(id, ctx);
  }
}
