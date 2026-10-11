import { Injectable } from '@nestjs/common';
import { ok, err, Result } from '@common/result';
import { DatabaseError } from '@common/errors/infrastructure.error';
import { NotFoundError } from '@domain/errors/domain.error';
import { PgPoolService } from '../connection/pg-pool.service';
import { AuditService } from '../audit/audit.service';
import { AuditContext } from '../audit/audit-event.types';
import { Configuration } from '../types/database.types';
import { PgBaseRepository } from './base/pg-base.repository';

export interface IConfigurationRepository {
  findById(id: string): Promise<Result<Configuration, NotFoundError | DatabaseError>>;
  findByKey(
    namespace: string,
    key: string,
  ): Promise<Result<Configuration | undefined, DatabaseError>>;
  findByNamespace(namespace: string): Promise<Result<Configuration[], DatabaseError>>;
  findAll(): Promise<Result<Configuration[], DatabaseError>>;
  set(
    namespace: string,
    key: string,
    value: unknown,
    type: string,
    ctx?: AuditContext,
  ): Promise<Result<Configuration, DatabaseError>>;
  delete(id: string, ctx?: AuditContext): Promise<Result<void, NotFoundError | DatabaseError>>;
}

@Injectable()
export class ConfigurationRepository
  extends PgBaseRepository<'configuration'>
  implements IConfigurationRepository
{
  protected readonly tableName = 'configuration' as const;

  constructor(pool: PgPoolService, audit: AuditService) {
    super(pool, audit);
  }

  findById(id: string) {
    return this._findById(id) as unknown as Promise<
      Result<Configuration, NotFoundError | DatabaseError>
    >;
  }

  async findByKey(
    namespace: string,
    key: string,
  ): Promise<Result<Configuration | undefined, DatabaseError>> {
    try {
      const row = await this.db
        .selectFrom('configuration')
        .selectAll()
        .where('namespace', '=', namespace)
        .where('key', '=', key)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      return ok(row);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  async findByNamespace(namespace: string): Promise<Result<Configuration[], DatabaseError>> {
    try {
      const rows = await this.db
        .selectFrom('configuration')
        .selectAll()
        .where('namespace', '=', namespace)
        .where('deleted_at', 'is', null)
        .orderBy('key', 'asc')
        .execute();
      return ok(rows);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  findAll() {
    return this._findAll() as unknown as Promise<Result<Configuration[], DatabaseError>>;
  }

  async set(
    namespace: string,
    key: string,
    value: unknown,
    type: string,
    ctx?: AuditContext,
  ): Promise<Result<Configuration, DatabaseError>> {
    try {
      const row = await this.db
        .insertInto('configuration')
        .values({ namespace, key, value, type } as never)
        .onConflict((oc) =>
          oc.constraint('uq_configuration_namespace_key').doUpdateSet({
            value: value as never,
            type,
            version: this.db.dynamic.ref('configuration.version') as never,
            updated_at: new Date(),
          }),
        )
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.audit.log({
        tableName: 'configuration',
        recordId: (row as { id: string }).id,
        operation: 'UPDATE',
        newValue: row,
        ...ctx,
      });

      return ok(row as Configuration);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  delete(id: string, ctx?: AuditContext) {
    return this._softDelete(id, ctx);
  }
}
