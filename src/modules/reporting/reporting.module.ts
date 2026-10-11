import { Module, OnModuleInit } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { TaskScheduler } from '@common/scheduling/task-scheduler';
import { AnalyticsModule } from '@modules/analytics/analytics.module';
import { PaperTradingModule } from '@modules/paper-trading/paper-trading.module';

// Builders
import { ExecutiveSummaryBuilder } from './application/builders/executive-summary.builder';
import { PortfolioPerformanceBuilder } from './application/builders/portfolio-performance.builder';
import { TradeSummaryBuilder } from './application/builders/trade-summary.builder';
import { RiskSectionBuilder } from './application/builders/risk-section.builder';
import { DrawdownAnalysisBuilder } from './application/builders/drawdown-analysis.builder';
import { ExecutionQualityBuilder } from './application/builders/execution-quality.builder';
import { ExposureAnalysisBuilder } from './application/builders/exposure-analysis.builder';
import { RecommendationsBuilder } from './application/builders/recommendations.builder';
import { ChartDataBuilder } from './application/builders/chart-data.builder';

// Exporters
import { JsonReportExporterService } from './application/exporters/json-report-exporter.service';
import { CsvReportExporterService } from './application/exporters/csv-report-exporter.service';
import { MarkdownReportExporterService } from './application/exporters/markdown-report-exporter.service';

// Services
import { StrategyComparatorService } from './application/services/strategy-comparator.service';
import { ReportGeneratorService } from './application/services/report-generator.service';
import { ReportSchedulerService } from './application/services/report-scheduler.service';

// Storage
import { ReportStorageService } from './application/storage/report-storage.service';

/**
 * ReportingModule provides the automated reporting engine.
 *
 * Dependencies:
 *   AnalyticsModule     — provides AnalyticsStorageService and AnalyticsReportService
 *   PaperTradingModule  — provides AnalyticsDataCollectorService (via AnalyticsModule)
 *   RedisModule         — @Global(); provides RedisClientService, RedisSortedSetService
 *   InfrastructureModule — @Global(); provides AppLoggerService
 *
 * The reporting engine NEVER:
 *   - Submits orders or modifies strategy state
 *   - Recomputes analytics (reads from analytics storage only)
 *   - Modifies paper trading or live trading state
 *
 * Exported services:
 *   ReportGeneratorService   — generate reports on demand
 *   ReportSchedulerService   — trigger scheduled reports manually
 *   ReportStorageService     — query historical reports
 *   JsonReportExporterService / CsvReportExporterService / MarkdownReportExporterService
 */
@Module({
  imports: [AnalyticsModule, PaperTradingModule],
  providers: [
    // Infrastructure (in-process scheduler — shared with other modules)
    TaskScheduler,

    // Builders (stateless, pure)
    ExecutiveSummaryBuilder,
    PortfolioPerformanceBuilder,
    TradeSummaryBuilder,
    RiskSectionBuilder,
    DrawdownAnalysisBuilder,
    ExecutionQualityBuilder,
    ExposureAnalysisBuilder,
    RecommendationsBuilder,
    ChartDataBuilder,

    // Exporters
    JsonReportExporterService,
    CsvReportExporterService,
    MarkdownReportExporterService,

    // Services
    StrategyComparatorService,
    ReportGeneratorService,
    ReportSchedulerService,

    // Storage
    ReportStorageService,
  ],
  exports: [
    ReportGeneratorService,
    ReportSchedulerService,
    ReportStorageService,
    JsonReportExporterService,
    CsvReportExporterService,
    MarkdownReportExporterService,
  ],
})
export class ReportingModule implements OnModuleInit {
  private readonly context = ReportingModule.name;

  constructor(private readonly logger: AppLoggerService) {}

  onModuleInit(): void {
    this.logger.log(
      'ReportingModule initialized — daily/weekly/monthly report schedules active',
      this.context,
    );
  }
}
