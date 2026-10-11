import { Kysely } from 'kysely';
import { ok, err, Result } from '@common/result';
import { DatabaseError } from '@common/errors/infrastructure.error';
import { NotFoundError } from '@domain/errors/domain.error';
import { PgPoolService } from '../../connection/pg-pool.service';
import { TransactionContext } from '../../transaction/transaction.context';
import { AuditService } from '../../audit/audit.service';
import { AuditContext } from '../../audit/audit-event.types';
import { Database } from '../../types/database.types';
import {
  PaginationParams,
  PaginatedResult,
  buildPaginatedResult,
  paginationToOffsetLimit,
} from '../../query/pagination.types';

export type TableName = keyof Database;

/**
 * PgBaseRepository provides protected CRUD helpers for all repositories.
 *
 * All helper methods are prefixed with _ to avoid naming conflicts with
 * the public domain interface methods defined in subclasses.
 *
 * Key contract:
 * - All mutations call AuditService.log() automatically.
 * - Soft-delete via deleted_at column; hard-delete is never exposed.
 * - Optimistic locking via version column (_updateWithVersion).
 * - AsyncLocalStorage-based transaction participation via TransactionContext.
 * - Never throws вЂ” always returns Result<T, DatabaseError>.
 */
export abstract class PgBaseRepository<TTable extends TableName> {
  protected abstract readonly tableName: TTable;

  constructor(
    protected readonly pool: PgPoolService,
    protected readonly audit: AuditService,
  ) {}

  protected get db(): Kysely<Database> {
    return (TransactionContext.getCurrent() ?? this.pool.db) as Kysely<Database>;
  }

  // anyDb is intentionally typed as any so that generic TTable-parameterized
  // query builder chains compile вЂ” Kysely's overloads are incompatible across
  // the full union of all 16 table types when TTable is unresolved.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private get anyDb(): Kysely<any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.db as Kysely<any>;
  }

  // в”Ђв”Ђ Find в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

  protected async _findById(
    id: string,
  ): Promise<Result<Database[TTable], NotFoundError | DatabaseError>> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const qb = this.anyDb.selectFrom(this.tableName) as any;
      const row = await qb
        .selectAll()
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();

      if (!row) {
        return err(new NotFoundError(String(this.tableName), id));
      }
      return ok(row as Database[TTable]);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  protected async _findAll(
    pagination?: PaginationParams,
  ): Promise<Result<Database[TTable][], DatabaseError>> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let qb: any = (this.anyDb.selectFrom(this.tableName) as any)
        .selectAll()
        .where('deleted_at', 'is', null);

      if (pagination) {
        const { offset, limit } = paginationToOffsetLimit(pagination);
        qb = qb.offset(offset).limit(limit);
      }

      const rows = await qb.execute();
      return ok(rows as Database[TTable][]);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  protected async _findAllPaginated(
    pagination: PaginationParams,
  ): Promise<Result<PaginatedResult<Database[TTable]>, DatabaseError>> {
    try {
      const { offset, limit } = paginationToOffsetLimit(pagination);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const base = (): any => this.anyDb.selectFrom(this.tableName) as any;
      const [rows, countRow] = await Promise.all([
        base().selectAll().where('deleted_at', 'is', null).offset(offset).limit(limit).execute(),
        base()
          .where('deleted_at', 'is', null)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .select((eb: any) => eb.fn.countAll().as('count'))
          .executeTakeFirstOrThrow(),
      ]);

      const total = parseInt((countRow as { count: string }).count, 10);
      return ok(buildPaginatedResult(rows as Database[TTable][], total, pagination));
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  // в”Ђв”Ђ Insert в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

  protected async _insert(
    values: Record<string, unknown>,
    auditCtx?: AuditContext,
  ): Promise<Result<Database[TTable], DatabaseError>> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = await (this.anyDb.insertInto(this.tableName) as any)
        .values(values)
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.audit.log({
        tableName: String(this.tableName),
        recordId: (row as { id: string }).id,
        operation: 'INSERT',
        newValue: row,
        ...auditCtx,
      });

      return ok(row as Database[TTable]);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  protected async _insertMany(
    values: Record<string, unknown>[],
    auditCtx?: AuditContext,
  ): Promise<Result<Database[TTable][], DatabaseError>> {
    if (values.length === 0) return ok([]);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await (this.anyDb.insertInto(this.tableName) as any)
        .values(values)
        .returningAll()
        .execute();

      await this.audit.logBatch(
        (rows as Array<{ id: string }>).map((row, i) => ({
          tableName: String(this.tableName),
          recordId: row.id,
          operation: 'INSERT' as const,
          newValue: rows[i],
          ...auditCtx,
        })),
      );

      return ok(rows as Database[TTable][]);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  // в”Ђв”Ђ Update в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

  protected async _update(
    id: string,
    values: Record<string, unknown>,
    auditCtx?: AuditContext,
  ): Promise<Result<Database[TTable], NotFoundError | DatabaseError>> {
    try {
      const payload = { ...values, updated_at: new Date() };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = await (this.anyDb.updateTable(this.tableName) as any)
        .set(payload)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst();

      if (!row) {
        return err(new NotFoundError(String(this.tableName), id));
      }

      await this.audit.log({
        tableName: String(this.tableName),
        recordId: id,
        operation: 'UPDATE',
        newValue: row,
        ...auditCtx,
      });

      return ok(row as Database[TTable]);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  // в”Ђв”Ђ Optimistic locking в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

  protected async _updateWithVersion(
    id: string,
    expectedVersion: number,
    values: Record<string, unknown>,
    auditCtx?: AuditContext,
  ): Promise<Result<Database[TTable], NotFoundError | DatabaseError>> {
    try {
      const payload = {
        ...values,
        version: expectedVersion + 1,
        updated_at: new Date(),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = await (this.anyDb.updateTable(this.tableName) as any)
        .set(payload)
        .where('id', '=', id)
        .where('version', '=', expectedVersion)
        .returningAll()
        .executeTakeFirst();

      if (!row) {
        return err(
          new DatabaseError(
            `Optimistic lock conflict on ${String(this.tableName)} ${id} (expected version ${expectedVersion})`,
          ),
        );
      }

      await this.audit.log({
        tableName: String(this.tableName),
        recordId: id,
        operation: 'UPDATE',
        newValue: row,
        ...auditCtx,
      });

      return ok(row as Database[TTable]);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  // в”Ђв”Ђ Soft Delete в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

  protected async _softDelete(
    id: string,
    auditCtx?: AuditContext,
  ): Promise<Result<void, NotFoundError | DatabaseError>> {
    try {
      const existing = await this._findById(id);
      if (existing.isErr())
        return existing as unknown as Result<void, NotFoundError | DatabaseError>;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.anyDb.updateTable(this.tableName) as any)
        .set({ deleted_at: new Date(), updated_at: new Date() })
        .where('id', '=', id)
        .execute();

      await this.audit.log({
        tableName: String(this.tableName),
        recordId: id,
        operation: 'DELETE',
        oldValue: existing.value,
        ...auditCtx,
      });

      return ok(undefined);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  // в”Ђв”Ђ Streaming в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

  protected _stream(): AsyncIterableIterator<Database[TTable]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.anyDb.selectFrom(this.tableName) as any)
      .selectAll()
      .where('deleted_at', 'is', null)
      .stream() as AsyncIterableIterator<Database[TTable]>;
  }

  // в”Ђв”Ђ Existence в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

  protected async _exists(id: string): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.anyDb.selectFrom(this.tableName) as any)
      .select('id')
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row !== undefined;
  }

  // в”Ђв”Ђ Error mapping в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

  protected _toDbError(error: unknown): DatabaseError {
    if (error instanceof DatabaseError) return error;
    const cause = error instanceof Error ? error : undefined;
    return new DatabaseError(cause?.message ?? 'Database operation failed', undefined, cause);
  }
}
