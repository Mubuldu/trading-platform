import { Module, OnModuleInit } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { PaperTradingModule } from '@modules/paper-trading/paper-trading.module';

// Calculators
import { PerformanceCalculator } from './application/calculators/performance.calculator';
import { RiskMetricsCalculator } from './application/calculators/risk-metrics.calculator';
import { TradeMetricsCalculator } from './application/calculators/trade-metrics.calculator';
import { ExposureCalculator } from './application/calculators/exposure.calculator';
import { ExecutionAnalyticsCalculator } from './application/calculators/execution-analytics.calculator';
import { CapitalMetricsCalculator } from './application/calculators/capital-metrics.calculator';
import { RollingMetricsCalculator } from './application/calculators/rolling-metrics.calculator';
import { BenchmarkCalculator } from './application/calculators/benchmark.calculator';

// Services
import { AnalyticsDataCollectorService } from './application/services/analytics-data-collector.service';
import { AnalyticsEngineService } from './application/services/analytics-engine.service';

// Reports
import { AnalyticsReportService } from './application/reports/analytics-report.service';

// Exporters
import { CsvExporterService } from './application/exporters/csv-exporter.service';
import { JsonExporterService } from './application/exporters/json-exporter.service';
import { ParquetExporterService } from './application/exporters/parquet-exporter.service';

// Storage
import { AnalyticsStorageService } from './storage/analytics-storage.service';

/**
 * AnalyticsModule provides the institutional-grade analytics engine.
 *
 * Dependencies:
 *   PaperTradingModule — provides PaperStateStoreService, PaperAccountService,
 *                        and PaperPortfolioManagerService that supply the raw data.
 *   RedisModule        — @Global(); provides RedisClientService and RedisSortedSetService.
 *   InfrastructureModule — @Global(); provides AppLoggerService.
 *
 * The analytics engine NEVER:
 *   - Submits orders
 *   - Modifies strategies
 *   - Writes to paper trading Redis keys
 *
 * Exported services:
 *   AnalyticsEngineService  — trigger computation, query snapshots
 *   AnalyticsReportService  — higher-level report generation
 *   CsvExporterService      — CSV export
 *   JsonExporterService     — JSON export
 */
@Module({
  imports: [PaperTradingModule],
  providers: [
    // Calculators (pure, stateless)
    PerformanceCalculator,
    RiskMetricsCalculator,
    TradeMetricsCalculator,
    ExposureCalculator,
    ExecutionAnalyticsCalculator,
    CapitalMetricsCalculator,
    RollingMetricsCalculator,
    BenchmarkCalculator,

    // Services
    AnalyticsDataCollectorService,
    AnalyticsEngineService,

    // Reports
    AnalyticsReportService,

    // Exporters
    CsvExporterService,
    JsonExporterService,
    ParquetExporterService,

    // Storage
    AnalyticsStorageService,
  ],
  exports: [
    AnalyticsDataCollectorService, // needed by ReportGeneratorService in ReportingModule
    AnalyticsEngineService,
    AnalyticsReportService,
    CsvExporterService,
    JsonExporterService,
    ParquetExporterService,
    AnalyticsStorageService,
  ],
})
export class AnalyticsModule implements OnModuleInit {
  private readonly context = AnalyticsModule.name;

  constructor(private readonly logger: AppLoggerService) {}

  onModuleInit(): void {
    this.logger.log('AnalyticsModule initialized — analytics engine ready', this.context);
  }
}
