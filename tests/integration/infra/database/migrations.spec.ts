/**
 * Database migration integration tests
 *
 * Verifies end-to-end migration behaviour against a real PostgreSQL instance:
 *
 *   1. All 3 migrations apply without error.
 *   2. Every expected table and production index exists after migrateToLatest().
 *   3. Migrations are idempotent — running them a second time is a no-op.
 *   4. The Kysely migration tracking table records all applied migrations.
 *   5. migrateDown() correctly rolls back migration 003 (alerts).
 *   6. migrateToLatest() after rollback re-creates the alerts table.
 *
 * Requires: docker compose -f docker-compose.test.yml up -d --wait
 *
 * When PostgreSQL is not reachable every test returns early (trivial pass).
 */

import { Kysely } from 'kysely';
import { Migrator } from 'kysely/migration';

// Source migrations — same modules registered in MigrationManager
import * as migration001 from '@infrastructure/database/migration/migrations/001_initial_schema';
import * as migration002 from '@infrastructure/database/migration/migrations/002_indexes';
import * as migration003 from '@infrastructure/database/migration/migrations/003_alerts';

import {
  createTestDatabase,
  checkPostgresAvailable,
  resetPublicSchema,
  tableExists,
  indexExists,
  countMigrations,
  TestDatabase,
  TEST_PG_HOST,
  TEST_PG_PORT,
} from '../helpers/postgres.helper';

// ─── Migration registry ───────────────────────────────────────────────────────

const MIGRATIONS = {
  '001_initial_schema': migration001,
  '002_indexes': migration002,
  '003_alerts': migration003,
};

// ─── Expected schema inventory ────────────────────────────────────────────────

/** All tables created by migrations 001 + 003. */
const EXPECTED_TABLES = [
  'accounts',
  'balances',
  'positions',
  'orders',
  'fills',
  'executions',
  'strategies',
  'strategy_parameters',
  'risk_profiles',
  'symbols',
  'assets',
  'exchange_metadata',
  'candles',
  'system_logs',
  'audit_logs',
  'configuration',
  'alerts', // added by migration 003
] as const;

/** A representative subset of indexes from migration 002 + 003. */
const SPOT_CHECK_INDEXES = [
  // Migration 002 — core indexes
  'idx_accounts_status',
  'idx_positions_open',
  'idx_orders_account_symbol',
  'idx_fills_account_symbol',
  'idx_strategies_account_id',
  'uq_symbols_exchange_symbol',
  'uq_configuration_namespace_key',
  'idx_candles_lookup',
  'idx_audit_logs_created_at',
  // Migration 003 — alerts indexes
  'idx_alerts_fingerprint_status',
  'idx_alerts_level_status',
  'idx_alerts_open',
] as const;

// ─── Helper ───────────────────────────────────────────────────────────────────

function buildMigrator(db: Kysely<unknown>): Migrator {
  return new Migrator({
    db,
    provider: {
      getMigrations: async () => MIGRATIONS,
    },
    // Use the default table name ('kysely_migration') so our countMigrations()
    // helper can query it without knowing a custom name.
  });
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('Database migrations — real PostgreSQL', () => {
  let handle: TestDatabase;
  let available = false;
  let migrator: Migrator;

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  beforeAll(async () => {
    handle = createTestDatabase();
    available = await checkPostgresAvailable(handle.pool);

    if (!available) {
      console.warn(
        `\n⚠  PostgreSQL not reachable at ${TEST_PG_HOST}:${TEST_PG_PORT} — skipping migration tests.` +
          `\n   Start the test containers: docker compose -f docker-compose.test.yml up -d --wait\n`,
      );
      return;
    }

    // Wipe the public schema so every test run starts from an empty database.
    // SAFE: this is the dedicated test container (trading_platform_test on 5433).
    await resetPublicSchema(handle.db);
    migrator = buildMigrator(handle.db);
  }, 30_000);

  afterAll(async () => {
    await handle.db.destroy();
  });

  // ── Guard ─────────────────────────────────────────────────────────────────────

  function skipIfUnavailable(): boolean {
    return !available;
  }

  // ── Test 1: full migration run ────────────────────────────────────────────────

  it('migrateToLatest() applies all 3 migrations without error', async () => {
    if (skipIfUnavailable()) return;

    const { error, results } = await migrator.migrateToLatest();

    expect(error).toBeUndefined();
    expect(results).toHaveLength(3);
    expect(results!.every((r) => r.status === 'Success')).toBe(true);
    expect(results!.map((r) => r.migrationName)).toEqual([
      '001_initial_schema',
      '002_indexes',
      '003_alerts',
    ]);
  });

  // ── Test 2: table presence ────────────────────────────────────────────────────

  it.each(EXPECTED_TABLES)('table "%s" exists after migrateToLatest()', async (tableName) => {
    if (skipIfUnavailable()) return;
    expect(await tableExists(handle.db, tableName)).toBe(true);
  });

  // ── Test 3: index presence ────────────────────────────────────────────────────

  it.each(SPOT_CHECK_INDEXES)('index "%s" exists after migrateToLatest()', async (indexName) => {
    if (skipIfUnavailable()) return;
    expect(await indexExists(handle.db, indexName)).toBe(true);
  });

  // ── Test 4: migration tracking ────────────────────────────────────────────────

  it('kysely_migration table records all 3 applied migrations', async () => {
    if (skipIfUnavailable()) return;

    expect(await tableExists(handle.db, 'kysely_migration')).toBe(true);
    expect(await countMigrations(handle.db)).toBe(3);
  });

  // ── Test 5: idempotency ───────────────────────────────────────────────────────

  it('running migrateToLatest() a second time produces 0 new results (idempotent)', async () => {
    if (skipIfUnavailable()) return;

    const { error, results } = await migrator.migrateToLatest();

    expect(error).toBeUndefined();
    // When all migrations are already applied, results is empty (nothing pending)
    expect(results).toHaveLength(0);
  });

  // ── Test 6: rollback of migration 003 ────────────────────────────────────────

  it('migrateDown() rolls back migration 003 — alerts table is removed', async () => {
    if (skipIfUnavailable()) return;

    const { error } = await migrator.migrateDown();
    expect(error).toBeUndefined();

    // 003_alerts was the last migration — its table and indexes should be gone
    expect(await tableExists(handle.db, 'alerts')).toBe(false);

    // Tables from 001 must remain intact
    expect(await tableExists(handle.db, 'accounts')).toBe(true);
    expect(await tableExists(handle.db, 'orders')).toBe(true);

    // Migration history now has 2 rows
    expect(await countMigrations(handle.db)).toBe(2);
  });

  // ── Test 7: re-apply after rollback ──────────────────────────────────────────

  it('migrateToLatest() after rollback re-creates the alerts table and indexes', async () => {
    if (skipIfUnavailable()) return;

    const { error, results } = await migrator.migrateToLatest();
    expect(error).toBeUndefined();
    expect(results).toHaveLength(1);
    expect(results![0]!.migrationName).toBe('003_alerts');
    expect(results![0]!.status).toBe('Success');

    expect(await tableExists(handle.db, 'alerts')).toBe(true);
    expect(await indexExists(handle.db, 'idx_alerts_open')).toBe(true);
    expect(await countMigrations(handle.db)).toBe(3);
  });

  // ── Test 8: alerts table structure ───────────────────────────────────────────

  it('alerts table has the expected production columns', async () => {
    if (skipIfUnavailable()) return;

    const result = await handle.db
      .selectFrom('alerts' as never)
      .select(['id', 'level', 'category', 'condition', 'fingerprint', 'status'] as never[])
      .limit(0)
      .execute();

    // A 0-row query succeeds only if all selected columns exist
    expect(Array.isArray(result)).toBe(true);
  });

  // ── Test 9: full rollback chain ───────────────────────────────────────────────

  it('rolling back all migrations leaves only the Kysely tracking tables', async () => {
    if (skipIfUnavailable()) return;

    // Roll back 003 (already at latest from test 7), then 002, then 001
    await migrator.migrateDown(); // 003
    await migrator.migrateDown(); // 002
    await migrator.migrateDown(); // 001

    // All application tables should be gone
    for (const table of EXPECTED_TABLES) {
      expect(await tableExists(handle.db, table)).toBe(false);
    }

    // Kysely tracking tables themselves remain (they are not part of our migrations)
    expect(await tableExists(handle.db, 'kysely_migration')).toBe(true);
    expect(await countMigrations(handle.db)).toBe(0);

    // Re-apply everything so the suite ends in a consistent state
    const { error } = await migrator.migrateToLatest();
    expect(error).toBeUndefined();
  });
});
