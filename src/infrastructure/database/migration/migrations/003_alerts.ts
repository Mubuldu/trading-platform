import { Kysely, sql } from 'kysely';

/**
 * Migration 003: Alerting & Notification Engine
 *
 * Creates the `alerts` table which is the central persistence store for the
 * alerting engine. All alert lifecycle events (raise, suppress, escalate,
 * acknowledge, resolve) are reflected by updating a single row per fingerprint.
 *
 * Key design choices:
 *  - fingerprint index for O(1) deduplication lookups
 *  - partial index on (status = 'open') for efficient open-alert scans
 *  - suppressed_count tracks how many duplicate raises were collapsed
 *  - escalation_count tracks how many times the severity was promoted
 *  - is_recovery flag distinguishes failure alerts from recovery notifications
 *  - soft-delete (deleted_at) preserves history while hiding stale records
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('alerts')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    // ── Identification
    .addColumn('level', 'varchar(16)', (col) => col.notNull()) // INFO|WARNING|ERROR|CRITICAL|FATAL
    .addColumn('category', 'varchar(64)', (col) => col.notNull()) // AlertCategory
    .addColumn('condition', 'varchar(64)', (col) => col.notNull()) // AlertCondition
    .addColumn('title', 'varchar(256)', (col) => col.notNull())
    .addColumn('message', 'text', (col) => col.notNull())
    .addColumn('source', 'varchar(128)', (col) => col.notNull()) // originating service name
    // sha256(category:condition:source), first 64 hex chars — used for dedup
    .addColumn('fingerprint', 'varchar(64)', (col) => col.notNull())
    // ── Lifecycle
    .addColumn('status', 'varchar(16)', (col) => col.notNull().defaultTo('open'))
    // ── Context
    .addColumn('context', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    // ── Rate limiting / escalation state
    .addColumn('suppressed_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('escalation_count', 'integer', (col) => col.notNull().defaultTo(0))
    // ── Notification tracking
    .addColumn('notification_channels', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('notification_sent_at', 'timestamptz')
    // ── Resolution tracking
    .addColumn('acknowledged_by', 'varchar(128)')
    .addColumn('acknowledged_at', 'timestamptz')
    .addColumn('resolved_at', 'timestamptz')
    .addColumn('resolution_note', 'text')
    // ── Recovery flag
    .addColumn('is_recovery', 'boolean', (col) => col.notNull().defaultTo(false))
    // ── Standard columns
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('deleted_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // ── Indexes ──────────────────────────────────────────────────────────────────

  // Fast deduplication: look up existing open alert by fingerprint
  await db.schema
    .createIndex('idx_alerts_fingerprint_status')
    .on('alerts')
    .columns(['fingerprint', 'status'])
    .execute();

  // Dashboard queries: filter by level + status
  await db.schema
    .createIndex('idx_alerts_level_status')
    .on('alerts')
    .columns(['level', 'status'])
    .execute();

  // Dashboard queries: filter by category
  await db.schema.createIndex('idx_alerts_category').on('alerts').column('category').execute();

  // Time-range queries for recent alerts
  await db.schema.createIndex('idx_alerts_created_at').on('alerts').column('created_at').execute();

  // Partial index for fast open-alert scans (most common query path)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_alerts_open
    ON alerts (created_at DESC)
    WHERE status = 'open' AND deleted_at IS NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_alerts_open').ifExists().execute();
  await db.schema.dropIndex('idx_alerts_created_at').ifExists().execute();
  await db.schema.dropIndex('idx_alerts_category').ifExists().execute();
  await db.schema.dropIndex('idx_alerts_level_status').ifExists().execute();
  await db.schema.dropIndex('idx_alerts_fingerprint_status').ifExists().execute();
  await db.schema.dropTable('alerts').ifExists().execute();
}
