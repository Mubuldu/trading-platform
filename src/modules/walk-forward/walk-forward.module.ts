import { Module } from '@nestjs/common';
import { BacktestModule } from '@modules/backtest/backtest.module';
import { WindowGeneratorService } from './application/window-generator.service';
import { ParameterOptimizerService } from './application/parameter-optimizer.service';
import { ParameterStabilityAnalyzerService } from './application/parameter-stability-analyzer.service';
import { WalkForwardReportGeneratorService } from './application/walk-forward-report-generator.service';
import { WalkForwardEngineService } from './application/walk-forward-engine.service';

@Module({
  imports: [BacktestModule],
  providers: [
    WindowGeneratorService,
    ParameterOptimizerService,
    ParameterStabilityAnalyzerService,
    WalkForwardReportGeneratorService,
    WalkForwardEngineService,
  ],
  exports: [WalkForwardEngineService],
})
export class WalkForwardModule {}
