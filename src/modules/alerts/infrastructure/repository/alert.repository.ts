import { Injectable } from '@nestjs/common';
import { PgPoolService } from '@infrastructure/database/connection/pg-pool.service';
import { AuditService } from '@infrastructure/database/audit/audit.service';
import { PgBaseRepository } from '@infrastructure/database/repository/base/pg-base.repository';
import { AlertRecord } from '@infrastructure/database/types/database.types';
import { ok, err, Result } from '@common/result';
import { DatabaseError } from '@common/errors/infrastructure.error';
import { Alert, AlertStatus } from '../../domain/alert.entity';
import { AlertLevel } from '../../domain/alert-level.enum';
import { AlertCategory } from '../../domain/alert-category.enum';
import { AlertCondition } from '../../domain/alert-condition.enum';

// Kysely's Selectable<AlertRow> resolves Generated<string> → string at query time.
// We use a plain cast helper to bridge the type gap without losing safety elsewhere.
type SelectedAlertRow = Omit<AlertRecord, 'id'> & { id: string };

export interface AlertQueryOptions {
  readonly status?: AlertStatus;
  readonly level?: AlertLevel;
  readonly category?: AlertCategory;
  readonly source?: string;
  readonly since?: Date;
  readonly limit?: number;
  readonly offset?: number;
}

@Injectable()
export class AlertRepository extends PgBaseRepository<'alerts'> {
  protected readonly tableName = 'alerts' as const;

  constructor(pool: PgPoolService, audit: AuditService) {
    super(pool, audit);
  }

  // ── Write ──────────────────────────────────────────────────────────────────

  async save(alert: Alert): Promise<Result<Alert, DatabaseError>> {
    const values = this.toRow(alert);
    const result = await this._insert(values, { actor: 'alert-engine' });
    if (result.isErr()) return err(result.error);
    return ok(this.toDomain(result.value as unknown as SelectedAlertRow));
  }

  async update(alert: Alert): Promise<Result<Alert, DatabaseError>> {
    const values = this.toUpdateRow(alert);
    const result = await this._update(alert.id, values, { actor: 'alert-engine' });
    if (result.isErr()) return err(new DatabaseError(result.error.message));
    return ok(this.toDomain(result.value as unknown as SelectedAlertRow));
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  async findById(id: string): Promise<Result<Alert, DatabaseError>> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const qb = (this.db as any).selectFrom('alerts');
      const row = await qb
        .selectAll()
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();

      if (!row) return err(new DatabaseError(`Alert ${id} not found`));
      return ok(this.toDomain(row as unknown as SelectedAlertRow));
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  /**
   * Find the most-recent open alert matching a fingerprint.
   * Used by the engine for deduplication and cooldown checks.
   */
  async findOpenByFingerprint(fingerprint: string): Promise<Result<Alert | null, DatabaseError>> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const qb = (this.db as any).selectFrom('alerts');
      const row = await qb
        .selectAll()
        .where('fingerprint', '=', fingerprint)
        .where('status', '=', 'open')
        .where('deleted_at', 'is', null)
        .orderBy('created_at', 'desc')
        .limit(1)
        .executeTakeFirst();

      return ok(row ? this.toDomain(row as unknown as SelectedAlertRow) : null);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  /**
   * Find the most-recent open alert by category + condition + source.
   * Used by the recovery handler to find the alert to auto-resolve.
   */
  async findOpenByCondition(
    category: AlertCategory,
    condition: AlertCondition,
    source: string,
  ): Promise<Result<Alert | null, DatabaseError>> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const qb = (this.db as any).selectFrom('alerts');
      const row = await qb
        .selectAll()
        .where('category', '=', category)
        .where('condition', '=', condition)
        .where('source', '=', source)
        .where('status', '=', 'open')
        .where('deleted_at', 'is', null)
        .orderBy('created_at', 'desc')
        .limit(1)
        .executeTakeFirst();

      return ok(row ? this.toDomain(row as unknown as SelectedAlertRow) : null);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  async findMany(options: AlertQueryOptions = {}): Promise<Result<Alert[], DatabaseError>> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let qb: any = (this.db as any)
        .selectFrom('alerts')
        .selectAll()
        .where('deleted_at', 'is', null);

      if (options.status) qb = qb.where('status', '=', options.status);
      if (options.level) qb = qb.where('level', '=', options.level);
      if (options.category) qb = qb.where('category', '=', options.category);
      if (options.source) qb = qb.where('source', '=', options.source);
      if (options.since) qb = qb.where('created_at', '>=', options.since);

      qb = qb.orderBy('created_at', 'desc');
      if (options.limit) qb = qb.limit(options.limit);
      if (options.offset) qb = qb.offset(options.offset);

      const rows: SelectedAlertRow[] = await qb.execute();
      return ok(rows.map((r) => this.toDomain(r)));
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  /** Count open alerts grouped by level — used by health checks. */
  async countOpenByLevel(): Promise<Result<Record<string, number>, DatabaseError>> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: Array<{ level: string; count: string }> = await (this.db as any)
        .selectFrom('alerts')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .select(['level', (eb: any) => eb.fn.countAll().as('count')])
        .where('status', '=', 'open')
        .where('deleted_at', 'is', null)
        .groupBy('level')
        .execute();

      const result: Record<string, number> = {};
      for (const row of rows) {
        result[row.level] = parseInt(row.count, 10);
      }
      return ok(result);
    } catch (error) {
      return err(this._toDbError(error));
    }
  }

  // ── Mapping ────────────────────────────────────────────────────────────────

  private toRow(alert: Alert): Record<string, unknown> {
    return {
      id: alert.id,
      level: alert.level,
      category: alert.category,
      condition: alert.condition,
      title: alert.title,
      message: alert.message,
      source: alert.source,
      fingerprint: alert.fingerprint,
      status: alert.status,
      context: alert.context,
      suppressed_count: alert.suppressedCount,
      escalation_count: alert.escalationCount,
      notification_channels: alert.notificationChannels,
      notification_sent_at: alert.notificationSentAt,
      acknowledged_by: alert.acknowledgedBy,
      acknowledged_at: alert.acknowledgedAt,
      resolved_at: alert.resolvedAt,
      resolution_note: alert.resolutionNote,
      is_recovery: alert.isRecovery,
    };
  }

  private toUpdateRow(alert: Alert): Record<string, unknown> {
    return {
      level: alert.level,
      status: alert.status,
      suppressed_count: alert.suppressedCount,
      escalation_count: alert.escalationCount,
      notification_channels: alert.notificationChannels,
      notification_sent_at: alert.notificationSentAt,
      acknowledged_by: alert.acknowledgedBy,
      acknowledged_at: alert.acknowledgedAt,
      resolved_at: alert.resolvedAt,
      resolution_note: alert.resolutionNote,
      context: alert.context,
      message: alert.message,
      version: alert.escalationCount + alert.suppressedCount + 1, // bump version
    };
  }

  private toDomain(row: SelectedAlertRow): Alert {
    return {
      id: row.id,
      level: row.level as AlertLevel,
      category: row.category as AlertCategory,
      condition: row.condition as AlertCondition,
      title: row.title,
      message: row.message,
      source: row.source,
      fingerprint: row.fingerprint,
      status: row.status as AlertStatus,
      context: (row.context ?? {}) as Record<string, unknown>,
      suppressedCount: row.suppressed_count,
      escalationCount: row.escalation_count,
      notificationChannels: Array.isArray(row.notification_channels)
        ? (row.notification_channels as string[])
        : [],
      notificationSentAt: row.notification_sent_at ?? null,
      acknowledgedBy: row.acknowledged_by,
      acknowledgedAt: row.acknowledged_at ?? null,
      resolvedAt: row.resolved_at ?? null,
      resolutionNote: row.resolution_note,
      isRecovery: row.is_recovery,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
