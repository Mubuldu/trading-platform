import { Module } from '@nestjs/common';
import { StrategyModule } from '@modules/strategy/strategy.module';
import { BacktestEngineService } from './application/engine/backtest-engine.service';
import { BacktestIndicatorFactory } from './application/engine/backtest-indicator-factory';
import { BacktestRiskEvaluator } from './application/engine/backtest-risk-evaluator';
import { ReplayEngineService } from './application/replay/replay-engine.service';
import { HistoricalLoaderFactoryService } from './application/historical-loader/historical-loader-factory.service';
import { CsvHistoricalLoaderService } from './application/historical-loader/csv-historical-loader.service';
import { PostgreSqlHistoricalLoaderService } from './application/historical-loader/postgresql-historical-loader.service';
import { BinanceHistoricalFeedService } from './application/historical-loader/binance-historical-feed.service';
import { ExecutionSimulatorService } from './application/execution-simulator/execution-simulator.service';
import { OrderQueueService } from './application/execution-simulator/order-queue.service';
import { BacktestPortfolioTrackerService } from './application/portfolio/backtest-portfolio-tracker.service';
import { EquityCurveBuilderService } from './application/portfolio/equity-curve-builder.service';
import { PerformanceCalculatorService } from './application/reports/statistics/performance-calculator.service';
import { DrawdownCalculatorService } from './application/reports/statistics/drawdown-calculator.service';
import { RiskMetricsCalculatorService } from './application/reports/statistics/risk-metrics-calculator.service';
import { ReportGeneratorService } from './application/reports/report-generator.service';
import { BacktestHistoryService } from './application/services/backtest-history.service';
import { BacktestOptimizerService } from './application/services/backtest-optimizer.service';
import { BacktestController } from './application/controllers/backtest.controller';

@Module({
  imports: [
    // StrategyModule provides StrategyLoaderService, StrategyRegistryService, and
    // the factory registration for TREND_FOLLOWING_V1_TYPE.
    StrategyModule,
  ],
  controllers: [BacktestController],
  providers: [
    // ── Engine ────────────────────────────────────────────────────────────────
    BacktestEngineService,
    BacktestIndicatorFactory,
    BacktestRiskEvaluator,

    // ── Replay ────────────────────────────────────────────────────────────────
    ReplayEngineService,

    // ── Historical data loaders ───────────────────────────────────────────────
    HistoricalLoaderFactoryService,
    CsvHistoricalLoaderService,
    PostgreSqlHistoricalLoaderService,
    BinanceHistoricalFeedService,

    // ── Execution simulation ──────────────────────────────────────────────────
    ExecutionSimulatorService,
    OrderQueueService,

    // ── Portfolio tracking ────────────────────────────────────────────────────
    BacktestPortfolioTrackerService,
    EquityCurveBuilderService,

    // ── Reports & statistics ──────────────────────────────────────────────────
    PerformanceCalculatorService,
    DrawdownCalculatorService,
    RiskMetricsCalculatorService,
    ReportGeneratorService,

    // ── HTTP layer ────────────────────────────────────────────────────────────
    BacktestHistoryService,
    BacktestOptimizerService,
  ],
  exports: [BacktestEngineService, ReplayEngineService, HistoricalLoaderFactoryService],
})
export class BacktestModule {}
