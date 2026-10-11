/**
 * Shared PostgreSQL helpers for infrastructure integration tests.
 *
 * Connection coordinates default to the test Docker container (port 5433).
 * Override via environment variables when running against a different host.
 */

import { Pool } from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';

export const TEST_PG_HOST = process.env.TEST_PG_HOST ?? 'localhost';
export const TEST_PG_PORT = parseInt(process.env.TEST_PG_PORT ?? '5433', 10);
export const TEST_PG_DB = process.env.TEST_PG_DB ?? 'trading_platform_test';
export const TEST_PG_USER = process.env.TEST_PG_USER ?? 'trading';
export const TEST_PG_PASS = process.env.TEST_PG_PASS ?? 'trading_dev_password';

export interface TestDatabase {
  pool: Pool;
  db: Kysely<unknown>;
}

/**
 * Create a Kysely instance pointed at the test PostgreSQL container.
 * Caller is responsible for calling `db.destroy()` in afterAll.
 */
export function createTestDatabase(): TestDatabase {
  const pool = new Pool({
    host: TEST_PG_HOST,
    port: TEST_PG_PORT,
    database: TEST_PG_DB,
    user: TEST_PG_USER,
    password: TEST_PG_PASS,
    max: 5,
    connectionTimeoutMillis: 3_000,
  });

  const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
  return { pool, db };
}

/**
 * Try to acquire a connection from the pool.
 * Returns true if PostgreSQL is reachable; false if the container is not running.
 */
export async function checkPostgresAvailable(pool: Pool): Promise<boolean> {
  let client;
  try {
    client = await pool.connect();
    return true;
  } catch {
    return false;
  } finally {
    client?.release();
  }
}

/**
 * Wipe the public schema and re-create it — gives a completely clean slate.
 *
 * Safe to call only on the dedicated test database (trading_platform_test).
 * This is destructive: all tables, indexes, sequences, and extensions are
 * dropped. The Kysely migration history (kysely_migration*) is also cleared.
 */
export async function resetPublicSchema(db: Kysely<unknown>): Promise<void> {
  await sql`DROP SCHEMA IF EXISTS public CASCADE`.execute(db);
  await sql`CREATE SCHEMA public`.execute(db);
  await sql`GRANT ALL ON SCHEMA public TO ${sql.raw(TEST_PG_USER)}`.execute(db);
  await sql`GRANT ALL ON SCHEMA public TO public`.execute(db);
}

/**
 * Return true if `tableName` exists in the public schema.
 */
export async function tableExists(db: Kysely<unknown>, tableName: string): Promise<boolean> {
  const result = await sql<{ exists: boolean }>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ${sql.lit(tableName)}
    ) AS "exists"
  `.execute(db);
  return result.rows[0]?.exists ?? false;
}

/**
 * Return true if `indexName` exists in the public schema.
 */
export async function indexExists(db: Kysely<unknown>, indexName: string): Promise<boolean> {
  const result = await sql<{ exists: boolean }>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = ${sql.lit(indexName)}
    ) AS "exists"
  `.execute(db);
  return result.rows[0]?.exists ?? false;
}

/**
 * Count migration rows in the Kysely migration history table.
 */
export async function countMigrations(db: Kysely<unknown>): Promise<number> {
  const result = await sql<{ count: string }>`
    SELECT COUNT(*) AS count FROM kysely_migration
  `.execute(db);
  return parseInt(result.rows[0]?.count ?? '0', 10);
}
