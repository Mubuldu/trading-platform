import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kysely } from 'kysely';
import { Migrator, MigrationResult, Migration } from 'kysely/migration';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { DatabaseConfig } from '../config/database.config';
import { PgPoolService } from '../connection/pg-pool.service';
import * as migration001 from './migrations/001_initial_schema';
import * as migration002 from './migrations/002_indexes';
import * as migration003 from './migrations/003_alerts';

const MIGRATIONS = {
  '001_initial_schema': migration001,
  '002_indexes': migration002,
  '003_alerts': migration003,
};

/**
 * MigrationManager runs Kysely migrations at application startup.
 *
 * Migrations are embedded TypeScript modules (not filesystem discovery)
 * so they work correctly in both dev and compiled dist/ layouts.
 *
 * On startup:
 *   1. Runs all pending migrations in order.
 *   2. Logs each applied migration.
 *   3. Throws if any migration fails — the application will not start.
 *
 * Rollback: call rollbackLast() to undo the most recent migration.
 */
@Injectable()
export class MigrationManager {
  private readonly context = MigrationManager.name;
  private readonly migrator: Migrator;

  constructor(
    private readonly pool: PgPoolService,
    private readonly config: ConfigService,
    private readonly logger: AppLoggerService,
  ) {
    const dbConfig = this.config.get<DatabaseConfig>('database')!;

    this.migrator = new Migrator({
      db: this.pool.db as Kysely<unknown>,
      provider: {
        getMigrations: async (): Promise<Record<string, Migration>> => MIGRATIONS,
      },
      migrationTableName: dbConfig.migration.tableName,
    });
  }

  async runAll(): Promise<void> {
    this.logger.log('Running pending migrations', this.context);
    const { error, results } = await this.migrator.migrateToLatest();
    this.logResults(results ?? []);

    if (error) {
      this.logger.error('Migration failed', String(error), this.context);
      throw error instanceof Error ? error : new Error(String(error));
    }

    this.logger.log('All migrations applied successfully', this.context);
  }

  async rollbackLast(): Promise<void> {
    this.logger.warn('Rolling back last migration', this.context);
    const { error, results } = await this.migrator.migrateDown();
    this.logResults(results ?? []);

    if (error) {
      this.logger.error('Migration rollback failed', String(error), this.context);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  private logResults(results: MigrationResult[]): void {
    for (const result of results) {
      if (result.status === 'Success') {
        this.logger.log(`Migration ${result.direction}: ${result.migrationName}`, this.context);
      } else if (result.status === 'Error') {
        this.logger.error(`Migration failed: ${result.migrationName}`, '', this.context);
      }
    }
  }
}
