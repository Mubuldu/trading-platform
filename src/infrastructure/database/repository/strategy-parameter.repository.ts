import { Injectable } from '@nestjs/common';
import { ok, err, Result } from '@common/result';
import { DatabaseError } from '@common/errors/infrastructure.error';
import { NotFoundError } from '@domain/errors/domain.error';
import { PgPoolService } from '../connection/pg-pool.service';
import { AuditService } from '../audit/audit.service';
import { AuditContext } from '../audit/audit-event.types';
import {
  StrategyParameter,
  NewStrategyParameter,
  StrategyParameterUpdate,
} from '../types/database.types';
import { PgBaseRepository } from './base/pg-base.repository';

export interface IStrategyParameterRepository {
  findById(id: string): Promise<Result<StrategyParameter, NotFoundError | DatabaseError>>;
  findByStrategy(strategyId: string): Promise<Result<StrategyParameter[], DatabaseError>>;
  findByStrategyAndKey(
    strategyId: string,
    key: string,
  ): Promise<Result<StrategyParameter | undefined, DatabaseError>>;
  save(
    param: NewStrategyParameter,
    ctx?: AuditContext,
  ): Promise<Result<StrategyParameter, DatabaseError>>;
  saveMany(
    params: NewStrategyParameter[],
    ctx?: AuditContext,
  ): Promise<Result<StrategyParameter[], DatabaseError>>;
  update(
    id: string,
    values: StrategyParameterUpdate,
    ctx?: AuditContext,
  ): Promise<Result<StrategyParameter, NotFoundError | DatabaseError>>;
  upsert(
    strategyId: string,
    key: string,
    value: unknown,
    type: string,
    ctx?: AuditContext,
  ): Promise<Result<StrategyParameter, DatabaseError>>;
  deleteByStrategy(strategyId: string, ctx?: AuditContext): Promise<Result<void, DatabaseError>>;
}

@Injectable()
export class StrategyParameterRepository
  extends PgBaseRepository<'strategy_parameters'>
  implements IStrategyParameterRepository
{
  protected readonly tableName = 'strategy_parameters' as const;

  constructor(pool: PgPoolService, audit: AuditService) {
    super(pool, audit);
  }

  findById(id: string) {
    return this._findById(id) as unknown as Promise<
      Result<StrategyParameter, NotFoundError | DatabaseError>
    >;
  }

  async findByStrategy(strategyId: string): Promise<Result<StrategyParameter[], DatabaseError>> {
    try {
      const rows = await this.db
        .selectFrom('strategy_parameters')
        .selectAll()
        .where('strategy_id', '=', strategyId)
        .orderBy('key', 'asc')
        .execute();
      return ok(rows);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  async findByStrategyAndKey(
    strategyId: string,
    key: string,
  ): Promise<Result<StrategyParameter | undefined, DatabaseError>> {
    try {
      const row = await this.db
        .selectFrom('strategy_parameters')
        .selectAll()
        .where('strategy_id', '=', strategyId)
        .where('key', '=', key)
        .executeTakeFirst();
      return ok(row);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  save(param: NewStrategyParameter, ctx?: AuditContext) {
    return this._insert(param as Record<string, unknown>, ctx) as unknown as Promise<
      Result<StrategyParameter, DatabaseError>
    >;
  }

  saveMany(params: NewStrategyParameter[], ctx?: AuditContext) {
    return this._insertMany(params as Record<string, unknown>[], ctx) as unknown as Promise<
      Result<StrategyParameter[], DatabaseError>
    >;
  }

  update(id: string, values: StrategyParameterUpdate, ctx?: AuditContext) {
    return this._update(id, values as Record<string, unknown>, ctx) as unknown as Promise<
      Result<StrategyParameter, NotFoundError | DatabaseError>
    >;
  }

  async upsert(
    strategyId: string,
    key: string,
    value: unknown,
    type: string,
    ctx?: AuditContext,
  ): Promise<Result<StrategyParameter, DatabaseError>> {
    try {
      const existing = await this.findByStrategyAndKey(strategyId, key);
      if (existing.isErr()) return err(existing.error);

      if (existing.value) {
        const updated = await this._update(
          existing.value.id,
          { value, type } as Record<string, unknown>,
          ctx,
        );
        if (updated.isErr()) return err(updated.error as DatabaseError);
        return ok(updated.value as unknown as StrategyParameter);
      }

      return this.save({ strategy_id: strategyId, key, value, type } as NewStrategyParameter, ctx);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  async deleteByStrategy(
    strategyId: string,
    ctx?: AuditContext,
  ): Promise<Result<void, DatabaseError>> {
    try {
      await this.db
        .deleteFrom('strategy_parameters')
        .where('strategy_id', '=', strategyId)
        .execute();

      await this.audit.log({
        tableName: 'strategy_parameters',
        recordId: strategyId,
        operation: 'DELETE',
        reason: `Deleted all parameters for strategy ${strategyId}`,
        ...ctx,
      });

      return ok(undefined);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }
}
