import { Injectable } from '@nestjs/common';
import { ok, err, Result } from '@common/result';
import { DatabaseError } from '@common/errors/infrastructure.error';
import { NotFoundError } from '@domain/errors/domain.error';
import { PgPoolService } from '../connection/pg-pool.service';
import { AuditService } from '../audit/audit.service';
import { AuditContext } from '../audit/audit-event.types';
import { Asset, NewAsset, AssetUpdate } from '../types/database.types';
import { PgBaseRepository } from './base/pg-base.repository';

export interface IAssetRepository {
  findById(id: string): Promise<Result<Asset, NotFoundError | DatabaseError>>;
  findBySymbol(symbol: string): Promise<Result<Asset | undefined, DatabaseError>>;
  findStablecoins(): Promise<Result<Asset[], DatabaseError>>;
  findFiats(): Promise<Result<Asset[], DatabaseError>>;
  findAll(): Promise<Result<Asset[], DatabaseError>>;
  save(asset: NewAsset, ctx?: AuditContext): Promise<Result<Asset, DatabaseError>>;
  saveMany(assets: NewAsset[], ctx?: AuditContext): Promise<Result<Asset[], DatabaseError>>;
  update(
    id: string,
    values: AssetUpdate,
    ctx?: AuditContext,
  ): Promise<Result<Asset, NotFoundError | DatabaseError>>;
}

@Injectable()
export class AssetRepository extends PgBaseRepository<'assets'> implements IAssetRepository {
  protected readonly tableName = 'assets' as const;

  constructor(pool: PgPoolService, audit: AuditService) {
    super(pool, audit);
  }

  findById(id: string) {
    return this._findById(id) as unknown as Promise<Result<Asset, NotFoundError | DatabaseError>>;
  }

  async findBySymbol(symbol: string): Promise<Result<Asset | undefined, DatabaseError>> {
    try {
      const row = await this.db
        .selectFrom('assets')
        .selectAll()
        .where('symbol', '=', symbol)
        .executeTakeFirst();
      return ok(row);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  async findStablecoins(): Promise<Result<Asset[], DatabaseError>> {
    try {
      const rows = await this.db
        .selectFrom('assets')
        .selectAll()
        .where('is_stable', '=', true)
        .orderBy('symbol', 'asc')
        .execute();
      return ok(rows);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  async findFiats(): Promise<Result<Asset[], DatabaseError>> {
    try {
      const rows = await this.db
        .selectFrom('assets')
        .selectAll()
        .where('is_fiat', '=', true)
        .orderBy('symbol', 'asc')
        .execute();
      return ok(rows);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  findAll() {
    return this._findAll() as unknown as Promise<Result<Asset[], DatabaseError>>;
  }

  save(asset: NewAsset, ctx?: AuditContext) {
    return this._insert(asset as Record<string, unknown>, ctx) as unknown as Promise<
      Result<Asset, DatabaseError>
    >;
  }

  saveMany(assets: NewAsset[], ctx?: AuditContext) {
    return this._insertMany(assets as Record<string, unknown>[], ctx) as unknown as Promise<
      Result<Asset[], DatabaseError>
    >;
  }

  update(id: string, values: AssetUpdate, ctx?: AuditContext) {
    return this._update(id, values as Record<string, unknown>, ctx) as unknown as Promise<
      Result<Asset, NotFoundError | DatabaseError>
    >;
  }
}
