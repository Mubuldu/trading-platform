import { Module } from '@nestjs/common';
import { PaperTradingModule } from '@modules/paper-trading/paper-trading.module';
import { StrategyModule } from '@modules/strategy/strategy.module';
import { RiskModule } from '@modules/risk/risk.module';
import { MonitoringController } from './monitoring.controller';

/**
 * MonitoringModule exposes read-only observability endpoints for the paper
 * trading bot. It imports the live service providers and surfaces their state
 * through a REST API — no writes, no order submission, no state mutation.
 *
 * Routes (all under /api/v1/monitor, all x-api-key guarded):
 *   GET /overview    — combined snapshot: account + risk + today's P&L + strategy
 *   GET /positions   — open positions with unrealized P&L
 *   GET /orders      — pending (unfilled) paper orders
 *   GET /trades      — filled trade history
 *   GET /performance — daily / weekly / monthly / all-time P&L + drawdown
 *   GET /strategy    — strategy registry health
 */
@Module({
  imports: [
    PaperTradingModule, // provides PaperAccountService, PaperPortfolioManagerService,
    //                       PaperOrderBookService, PaperReportService, PaperStateStoreService
    StrategyModule,     // provides StrategyRegistryService
    RiskModule,         // provides RiskStateService for /risk endpoint
  ],
  controllers: [MonitoringController],
})
export class MonitoringModule {}
