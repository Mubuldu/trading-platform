import { Injectable } from '@nestjs/common';
import { ok, err, Result } from '@common/result';
import { DatabaseError } from '@common/errors/infrastructure.error';
import { NotFoundError } from '@domain/errors/domain.error';
import { PgPoolService } from '../connection/pg-pool.service';
import { AuditService } from '../audit/audit.service';
import { AuditContext } from '../audit/audit-event.types';
import {
  ExchangeMetadata,
  NewExchangeMetadata,
  ExchangeMetadataUpdate,
} from '../types/database.types';
import { PgBaseRepository } from './base/pg-base.repository';

export interface IExchangeMetadataRepository {
  findById(id: string): Promise<Result<ExchangeMetadata, NotFoundError | DatabaseError>>;
  findByExchangeId(
    exchangeId: string,
  ): Promise<Result<ExchangeMetadata | undefined, DatabaseError>>;
  findOnline(): Promise<Result<ExchangeMetadata[], DatabaseError>>;
  findAll(): Promise<Result<ExchangeMetadata[], DatabaseError>>;
  save(
    metadata: NewExchangeMetadata,
    ctx?: AuditContext,
  ): Promise<Result<ExchangeMetadata, DatabaseError>>;
  update(
    id: string,
    values: ExchangeMetadataUpdate,
    ctx?: AuditContext,
  ): Promise<Result<ExchangeMetadata, NotFoundError | DatabaseError>>;
  upsert(
    metadata: NewExchangeMetadata,
    ctx?: AuditContext,
  ): Promise<Result<ExchangeMetadata, DatabaseError>>;
}

@Injectable()
export class ExchangeMetadataRepository
  extends PgBaseRepository<'exchange_metadata'>
  implements IExchangeMetadataRepository
{
  protected readonly tableName = 'exchange_metadata' as const;

  constructor(pool: PgPoolService, audit: AuditService) {
    super(pool, audit);
  }

  findById(id: string) {
    return this._findById(id) as unknown as Promise<
      Result<ExchangeMetadata, NotFoundError | DatabaseError>
    >;
  }

  async findByExchangeId(
    exchangeId: string,
  ): Promise<Result<ExchangeMetadata | undefined, DatabaseError>> {
    try {
      const row = await this.db
        .selectFrom('exchange_metadata')
        .selectAll()
        .where('exchange_id', '=', exchangeId)
        .executeTakeFirst();
      return ok(row);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  async findOnline(): Promise<Result<ExchangeMetadata[], DatabaseError>> {
    try {
      const rows = await this.db
        .selectFrom('exchange_metadata')
        .selectAll()
        .where('status', '=', 'online')
        .execute();
      return ok(rows);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  findAll() {
    return this._findAll() as unknown as Promise<Result<ExchangeMetadata[], DatabaseError>>;
  }

  save(metadata: NewExchangeMetadata, ctx?: AuditContext) {
    return this._insert(metadata as Record<string, unknown>, ctx) as unknown as Promise<
      Result<ExchangeMetadata, DatabaseError>
    >;
  }

  update(id: string, values: ExchangeMetadataUpdate, ctx?: AuditContext) {
    return this._update(id, values as Record<string, unknown>, ctx) as unknown as Promise<
      Result<ExchangeMetadata, NotFoundError | DatabaseError>
    >;
  }

  async upsert(
    metadata: NewExchangeMetadata,
    ctx?: AuditContext,
  ): Promise<Result<ExchangeMetadata, DatabaseError>> {
    try {
      const row = await this.db
        .insertInto('exchange_metadata')
        .values(metadata as never)
        .onConflict((oc) =>
          oc.column('exchange_id').doUpdateSet({
            name: metadata.name,
            maker_fee: metadata.maker_fee,
            taker_fee: metadata.taker_fee,
            rate_limits: metadata.rate_limits,
            supports_spot: metadata.supports_spot,
            supports_futures: metadata.supports_futures,
            supports_margin: metadata.supports_margin,
            server_time_offset_ms: metadata.server_time_offset_ms,
            status: metadata.status,
            updated_at: new Date(),
          } as never),
        )
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.audit.log({
        tableName: 'exchange_metadata',
        recordId: (row as { id: string }).id,
        operation: 'INSERT',
        newValue: row,
        ...ctx,
      });

      return ok(row as ExchangeMetadata);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }
}
