import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolConfig } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import { DatabaseConfig } from '../config/database.config';
import { Database } from '../types/database.types';

/**
 * PgPoolService owns the pg.Pool and the Kysely instance.
 *
 * Both are created once at module init. All repositories and the transaction
 * manager inject this service to get the shared Kysely instance.
 *
 * Pool sizing defaults:
 *   min=2, max=20 — tunable via DB_POOL_* env vars.
 *   Each connection is kept-alive until idleTimeoutMs.
 *   Connection acquire will fail after acquireTimeoutMs.
 */
@Injectable()
export class PgPoolService implements OnModuleDestroy {
  private pool: Pool;
  private _db: Kysely<Database>;

  constructor(private readonly config: ConfigService) {
    const dbConfig = this.config.get<DatabaseConfig>('database')!;

    const poolConfig: PoolConfig = {
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      user: dbConfig.user,
      password: dbConfig.password,
      min: dbConfig.pool.min,
      max: dbConfig.pool.max,
      idleTimeoutMillis: dbConfig.pool.idleTimeoutMs,
      connectionTimeoutMillis: dbConfig.pool.connectionTimeoutMs,
      statement_timeout: dbConfig.statement.timeoutMs,
      query_timeout: dbConfig.statement.queryTimeoutMs,
      ssl: dbConfig.ssl ? { rejectUnauthorized: true } : false,
      application_name: 'trading-platform',
    };

    this.pool = new Pool(poolConfig);

    this._db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: this.pool }),
    });
  }

  get db(): Kysely<Database> {
    return this._db;
  }

  get rawPool(): Pool {
    return this.pool;
  }

  async onModuleDestroy(): Promise<void> {
    await this._db.destroy();
  }
}
