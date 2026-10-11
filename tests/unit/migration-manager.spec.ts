import { MigrationManager } from '@infrastructure/database/migration/migration-manager.service';
import { PgPoolService } from '@infrastructure/database/connection/pg-pool.service';
import { ConfigService } from '@nestjs/config';
import { AppLoggerService } from '@core/logging/app-logger.service';

describe('MigrationManager', () => {
  let manager: MigrationManager;
  let poolService: jest.Mocked<PgPoolService>;
  let configService: jest.Mocked<ConfigService>;
  let logger: jest.Mocked<AppLoggerService>;

  beforeEach(() => {
    poolService = {
      db: {} as never,
    } as unknown as jest.Mocked<PgPoolService>;

    configService = {
      get: jest.fn().mockReturnValue({
        migration: { tableName: 'kysely_migration' },
      }),
    } as unknown as jest.Mocked<ConfigService>;

    logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as jest.Mocked<AppLoggerService>;
  });

  it('instantiates without error', () => {
    // MigrationManager constructor builds the Kysely Migrator with embedded migrations
    // We just verify construction doesn't throw
    expect(() => {
      manager = new MigrationManager(poolService, configService, logger);
    }).not.toThrow();
  });

  describe('runAll()', () => {
    it('throws when Migrator.migrateToLatest returns an error', async () => {
      manager = new MigrationManager(poolService, configService, logger);

      // Patch the private migrator
      (manager as unknown as { migrator: { migrateToLatest: jest.Mock } }).migrator = {
        migrateToLatest: jest.fn().mockResolvedValue({
          error: new Error('migration failure'),
          results: [{ migrationName: '001_initial_schema', status: 'Error', direction: 'Up' }],
        }),
      };

      await expect(manager.runAll()).rejects.toThrow('migration failure');
      expect(logger.error).toHaveBeenCalled();
    });

    it('resolves without error when all migrations succeed', async () => {
      manager = new MigrationManager(poolService, configService, logger);

      (manager as unknown as { migrator: { migrateToLatest: jest.Mock } }).migrator = {
        migrateToLatest: jest.fn().mockResolvedValue({
          error: undefined,
          results: [
            { migrationName: '001_initial_schema', status: 'Success', direction: 'Up' },
            { migrationName: '002_indexes', status: 'Success', direction: 'Up' },
          ],
        }),
      };

      await expect(manager.runAll()).resolves.not.toThrow();
      expect(logger.log).toHaveBeenCalledWith(
        expect.stringContaining('successfully'),
        expect.any(String),
      );
    });
  });

  describe('rollbackLast()', () => {
    it('throws when rollback fails', async () => {
      manager = new MigrationManager(poolService, configService, logger);

      (manager as unknown as { migrator: { migrateDown: jest.Mock } }).migrator = {
        migrateDown: jest.fn().mockResolvedValue({
          error: new Error('rollback error'),
          results: [],
        }),
      };

      await expect(manager.rollbackLast()).rejects.toThrow('rollback error');
    });

    it('logs warning when rolling back', async () => {
      manager = new MigrationManager(poolService, configService, logger);

      (manager as unknown as { migrator: { migrateDown: jest.Mock } }).migrator = {
        migrateDown: jest.fn().mockResolvedValue({ error: undefined, results: [] }),
      };

      await manager.rollbackLast();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Rolling back'),
        expect.any(String),
      );
    });
  });
});
