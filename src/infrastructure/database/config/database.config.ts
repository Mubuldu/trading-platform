import { registerAs } from '@nestjs/config';

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  pool: {
    min: number;
    max: number;
    idleTimeoutMs: number;
    acquireTimeoutMs: number;
    connectionTimeoutMs: number;
  };
  migration: {
    runOnStartup: boolean;
    tableName: string;
  };
  statement: {
    timeoutMs: number;
    queryTimeoutMs: number;
  };
}

export const databaseConfig = registerAs('database', (): DatabaseConfig => ({
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  database: process.env.DB_NAME ?? 'trading_platform',
  user: process.env.DB_USER ?? 'trading',
  password: process.env.DB_PASSWORD ?? '',
  ssl: process.env.DB_SSL === 'true',
  pool: {
    min: parseInt(process.env.DB_POOL_MIN ?? '2', 10),
    max: parseInt(process.env.DB_POOL_MAX ?? '20', 10),
    idleTimeoutMs: parseInt(process.env.DB_IDLE_TIMEOUT_MS ?? '30000', 10),
    acquireTimeoutMs: parseInt(process.env.DB_ACQUIRE_TIMEOUT_MS ?? '30000', 10),
    connectionTimeoutMs: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS ?? '5000', 10),
  },
  migration: {
    runOnStartup: process.env.DB_MIGRATE_ON_STARTUP !== 'false',
    tableName: process.env.DB_MIGRATION_TABLE ?? 'kysely_migration',
  },
  statement: {
    timeoutMs: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS ?? '30000', 10),
    queryTimeoutMs: parseInt(process.env.DB_QUERY_TIMEOUT_MS ?? '30000', 10),
  },
}));
