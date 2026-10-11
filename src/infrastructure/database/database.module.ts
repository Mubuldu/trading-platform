import { Global, Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { DatabaseConfig } from './config/database.config';

// Connection
import { PgPoolService } from './connection/pg-pool.service';
import { PgDatabaseManager } from './connection/pg-database-manager.service';

// Migration
import { MigrationManager } from './migration/migration-manager.service';

// Transaction
import { TransactionManager } from './transaction/transaction-manager.service';

// Audit
import { AuditService } from './audit/audit.service';

// Health
import { DatabaseHealthService } from './health/database-health.service';

// Repositories
import {
  AccountRepository,
  BalanceRepository,
  PositionRepository,
  OrderRepository,
  FillRepository,
  ExecutionRepository,
  StrategyRepository,
  StrategyParameterRepository,
  RiskProfileRepository,
  SymbolRepository,
  AssetRepository,
  ExchangeMetadataRepository,
  CandleRepository,
  SystemLogRepository,
  AuditLogRepository,
  ConfigurationRepository,
} from './repository';

import { DATABASE_TOKENS } from './database.tokens';

const REPOSITORIES = [
  { provide: DATABASE_TOKENS.ACCOUNT_REPOSITORY, useClass: AccountRepository },
  { provide: DATABASE_TOKENS.BALANCE_REPOSITORY, useClass: BalanceRepository },
  { provide: DATABASE_TOKENS.POSITION_REPOSITORY, useClass: PositionRepository },
  { provide: DATABASE_TOKENS.ORDER_REPOSITORY, useClass: OrderRepository },
  { provide: DATABASE_TOKENS.FILL_REPOSITORY, useClass: FillRepository },
  { provide: DATABASE_TOKENS.EXECUTION_REPOSITORY, useClass: ExecutionRepository },
  { provide: DATABASE_TOKENS.STRATEGY_REPOSITORY, useClass: StrategyRepository },
  { provide: DATABASE_TOKENS.STRATEGY_PARAMETER_REPOSITORY, useClass: StrategyParameterRepository },
  { provide: DATABASE_TOKENS.RISK_PROFILE_REPOSITORY, useClass: RiskProfileRepository },
  { provide: DATABASE_TOKENS.SYMBOL_REPOSITORY, useClass: SymbolRepository },
  { provide: DATABASE_TOKENS.ASSET_REPOSITORY, useClass: AssetRepository },
  { provide: DATABASE_TOKENS.EXCHANGE_METADATA_REPOSITORY, useClass: ExchangeMetadataRepository },
  { provide: DATABASE_TOKENS.CANDLE_REPOSITORY, useClass: CandleRepository },
  { provide: DATABASE_TOKENS.SYSTEM_LOG_REPOSITORY, useClass: SystemLogRepository },
  { provide: DATABASE_TOKENS.AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
  { provide: DATABASE_TOKENS.CONFIGURATION_REPOSITORY, useClass: ConfigurationRepository },
];

/**
 * DatabaseModule wires the entire persistence layer:
 *  - PgPoolService         (connection pool + Kysely instance)
 *  - PgDatabaseManager     (DatabaseProvider implementation)
 *  - MigrationManager      (schema migrations on startup)
 *  - TransactionManager    (business-layer transaction API)
 *  - AuditService          (immutable mutation audit trail)
 *  - DatabaseHealthService (pool health monitor)
 *  - 16 domain repositories (each bound behind a DI token)
 *
 * Import this module in InfrastructureModule.
 * Consumers inject via DATABASE_TOKENS to stay decoupled from pg/Kysely.
 */
@Global()
@Module({
  providers: [
    PgPoolService,
    PgDatabaseManager,
    MigrationManager,
    TransactionManager,
    AuditService,
    DatabaseHealthService,
    ...REPOSITORIES,
  ],
  exports: [
    PgPoolService,
    PgDatabaseManager,
    MigrationManager,
    TransactionManager,
    AuditService,
    DatabaseHealthService,
    ...REPOSITORIES.map((r) => r.provide),
  ],
})
export class DatabaseModule implements OnModuleInit {
  private readonly context = DatabaseModule.name;

  constructor(
    private readonly migrationManager: MigrationManager,
    private readonly config: ConfigService,
    private readonly logger: AppLoggerService,
  ) {}

  async onModuleInit(): Promise<void> {
    const dbConfig = this.config.get<DatabaseConfig>('database')!;

    if (dbConfig.migration.runOnStartup) {
      this.logger.log('Running database migrations on startup', this.context);
      await this.migrationManager.runAll();
    }
  }
}
