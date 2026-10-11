import { Injectable } from '@nestjs/common';
import { Kysely, Transaction } from 'kysely';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { Database, NewAuditLog } from '../types/database.types';
import { PgPoolService } from '../connection/pg-pool.service';
import { TransactionContext } from '../transaction/transaction.context';
import { AuditEvent } from './audit-event.types';

/**
 * AuditService writes immutable audit records for every database mutation.
 *
 * Every INSERT, UPDATE, and SOFT-DELETE that goes through a repository MUST
 * call log() with the before/after values. Audit records are never deleted.
 *
 * If a transaction is active (TransactionContext.getCurrent()), the audit
 * record is written inside the same transaction so it rolls back atomically
 * with the business mutation. If no transaction is active, it falls back to
 * the connection pool.
 *
 * Design note: audit_logs has no soft-delete. Once written it is permanent.
 */
@Injectable()
export class AuditService {
  private readonly context = AuditService.name;

  constructor(
    private readonly pool: PgPoolService,
    private readonly logger: AppLoggerService,
  ) {}

  async log(event: AuditEvent): Promise<void> {
    const db: Kysely<Database> | Transaction<Database> =
      TransactionContext.getCurrent() ?? this.pool.db;

    const row: NewAuditLog = {
      table_name: event.tableName,
      record_id: event.recordId,
      operation: event.operation,
      actor: event.actor ?? null,
      reason: event.reason ?? null,
      old_value: event.oldValue ?? null,
      new_value: event.newValue ?? null,
      correlation_id: event.correlationId ?? null,
    };

    try {
      await db.insertInto('audit_logs').values(row).execute();
    } catch (error) {
      // Audit failures must never crash the main operation — log and continue.
      this.logger.error(
        `Failed to write audit log for ${event.tableName}:${event.recordId}`,
        String(error),
        this.context,
      );
    }
  }

  async logBatch(events: AuditEvent[]): Promise<void> {
    if (events.length === 0) return;

    const db: Kysely<Database> | Transaction<Database> =
      TransactionContext.getCurrent() ?? this.pool.db;

    const rows: NewAuditLog[] = events.map((event) => ({
      table_name: event.tableName,
      record_id: event.recordId,
      operation: event.operation,
      actor: event.actor ?? null,
      reason: event.reason ?? null,
      old_value: event.oldValue ?? null,
      new_value: event.newValue ?? null,
      correlation_id: event.correlationId ?? null,
    }));

    try {
      await db.insertInto('audit_logs').values(rows).execute();
    } catch (error) {
      this.logger.error(`Failed to write ${events.length} audit logs`, String(error), this.context);
    }
  }
}
