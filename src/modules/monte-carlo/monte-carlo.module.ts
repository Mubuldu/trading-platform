import { Module } from '@nestjs/common';
import { BacktestModule } from '@modules/backtest/backtest.module';
import { BootstrapResamplerService } from './application/bootstrap-resampler.service';
import { TradeRandomizerService } from './application/trade-randomizer.service';
import { SimulationRunnerService } from './application/simulation-runner.service';
import { StatisticsAggregatorService } from './application/statistics-aggregator.service';
import { RobustnessScorerService } from './application/robustness-scorer.service';
import { MonteCarloEngineService } from './application/monte-carlo-engine.service';

/**
 * MonteCarloModule
 *
 * Provides the full Monte Carlo stress-testing pipeline.
 * Consumers should inject `MonteCarloEngineService` and call `.run(trades, config)`.
 *
 * Depends on BacktestModule only for its shared type definitions;
 * the Monte Carlo engine does not re-run any backtest internally.
 */
@Module({
  imports: [BacktestModule],
  providers: [
    BootstrapResamplerService,
    TradeRandomizerService,
    SimulationRunnerService,
    StatisticsAggregatorService,
    RobustnessScorerService,
    MonteCarloEngineService,
  ],
  exports: [MonteCarloEngineService],
})
export class MonteCarloModule {}
