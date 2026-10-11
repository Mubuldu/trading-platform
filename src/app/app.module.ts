import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from '@config/config.module';
import { LoggingModule } from '@core/logging/logging.module';
import { MetricsModule } from '@core/metrics/metrics.module';
import { TracingModule } from '@core/tracing/tracing.module';
import { HealthModule } from '@core/health/health.module';
import { DiagnosticsModule } from '@core/diagnostics/diagnostics.module';
import { InfrastructureModule } from '@infrastructure/infrastructure.module';
import { CorrelationIdMiddleware } from '@common/middleware/correlation-id.middleware';
import { RequestLoggingMiddleware } from '@common/middleware/request-logging.middleware';
import { IndicatorModule } from '../modules/indicator/indicator.module';
import { StrategyModule } from '../modules/strategy/strategy.module';
import { RiskModule } from '../modules/risk/risk.module';
import { ExecutionModule } from '../modules/execution/execution.module';
import { PositionModule } from '../modules/position/position.module';
import { OrderModule } from '../modules/order/order.module';
import { ReconciliationModule } from '../modules/reconciliation/reconciliation.module';
import { PortfolioModule } from '../modules/portfolio/portfolio.module';
import { BacktestModule } from '../modules/backtest/backtest.module';
import { WalkForwardModule } from '../modules/walk-forward/walk-forward.module';
import { MonteCarloModule } from '../modules/monte-carlo/monte-carlo.module';
import { ParameterStabilityModule } from '../modules/parameter-stability/parameter-stability.module';
import { PaperTradingModule } from '../modules/paper-trading/paper-trading.module';
import { AnalyticsModule } from '../modules/analytics/analytics.module';
import { ReportingModule } from '../modules/reporting/reporting.module';
import { AlertsModule } from '../modules/alerts/alerts.module';
import { ResearchModule } from '../modules/research/research.module';
import { MonitoringModule } from '../modules/monitoring/monitoring.module';
import { MarketDataModule } from '../modules/market-data/market-data.module';

/**
 * AppModule is the root of the NestJS dependency injection graph.
 *
 * Module loading order matters:
 *  1. ConfigModule        — must be first; all others depend on ConfigService
 *  2. LoggingModule       — must be second; all others use AppLoggerService
 *  3. MetricsModule       — global IMetrics + RuntimeStatsCollector
 *  4. TracingModule       — global ITracing + TracingService
 *  5. ThrottlerModule     — global HTTP rate limiting (200 req / 60 s per IP)
 *  6. InfrastructureModule — database, redis, health registry, lifecycle
 *  7. HealthModule        — /health, /live, /ready endpoints
 *  8. DiagnosticsModule   — /diagnostics endpoints (API-key guarded)
 *
 * Middleware applied globally in order:
 *  CorrelationIdMiddleware → RequestLoggingMiddleware
 *
 * The correlation ID must be established in AsyncLocalStorage before the
 * request logger reads it. Metrics are injected into RequestLoggingMiddleware
 * via METRICS_TOKEN (available globally from MetricsModule).
 */
@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    MetricsModule,
    TracingModule,
    // Global HTTP rate limiting: 200 requests per 60 s per IP.
    // Health and diagnostics endpoints are separately guarded; this limit
    // covers all other routes. Adjust limits per-route using @Throttle().
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000, // 60 seconds window
        limit: 200, // max requests per window per IP
      },
    ]),
    InfrastructureModule,
    HealthModule,
    DiagnosticsModule,
    IndicatorModule,
    StrategyModule,
    RiskModule,
    ExecutionModule,
    PositionModule,
    OrderModule,
    ReconciliationModule,
    PortfolioModule,
    BacktestModule,
    WalkForwardModule,
    MonteCarloModule,
    ParameterStabilityModule,
    PaperTradingModule,
    AnalyticsModule,
    ReportingModule,
    AlertsModule,
    // Milestone 34 — Quant Research Sandbox.
    // Isolated: never imports Execution, Risk, Order, or Portfolio modules.
    ResearchModule,
    // Read-only observability: account, positions, orders, P&L, strategy health.
    MonitoringModule,
    // Real-time Binance public WS feed: ticker → PaperExchangeAdapter price ticks,
    // klines → Redis streams → indicator pipeline.
    MarketDataModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(CorrelationIdMiddleware, RequestLoggingMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
