import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { BacktestEngineService } from '@modules/backtest/application/engine/backtest-engine.service';
import { BacktestConfig } from '@modules/backtest/domain/models/backtest-config.model';
import { BacktestState } from '@modules/backtest/domain/enums/backtest-state.enum';
import { WalkForwardConfig } from '../domain/models/walk-forward-config.model';
import { WalkForwardResult } from '../domain/models/walk-forward-result.model';
import { WalkForwardWindowResult } from '../domain/models/walk-forward-window-result.model';
import { WalkForwardWindow } from '../domain/models/walk-forward-window.model';
import { ParameterOptimizerService } from './parameter-optimizer.service';
import { ParameterStabilityAnalyzerService } from './parameter-stability-analyzer.service';
import { WalkForwardReportGeneratorService } from './walk-forward-report-generator.service';
import { WindowGeneratorService } from './window-generator.service';

@Injectable()
export class WalkForwardEngineService {
  private readonly context = WalkForwardEngineService.name;

  constructor(
    private readonly windowGenerator: WindowGeneratorService,
    private readonly optimizer: ParameterOptimizerService,
    private readonly backtestEngine: BacktestEngineService,
    private readonly stabilityAnalyzer: ParameterStabilityAnalyzerService,
    private readonly reportGenerator: WalkForwardReportGeneratorService,
    private readonly logger: AppLoggerService,
  ) {}

  async run(config: WalkForwardConfig): Promise<WalkForwardResult> {
    const startedAt = Date.now();
    const windows = this.windowGenerator.generate(config);
    const gridSize = this.optimizer.expandGrid(config.parameterGrid).length;

    this.logger.log(
      `Walk-forward ${config.runId}: ${windows.length} windows × ${gridSize} param combos ` +
        `= ${windows.length * gridSize} optimization runs`,
      this.context,
    );

    const windowResults: WalkForwardWindowResult[] = [];
    let totalOptimizationRuns = 0;

    for (const window of windows) {
      const { candidates, totalAttempted } = await this.optimizer.optimize(window, config);
      totalOptimizationRuns += totalAttempted;

      if (candidates.length === 0) {
        this.logger.warn(
          `Window ${window.index}: no valid candidates after filtering — skipped`,
          this.context,
        );
        continue;
      }

      const best = candidates[0];
      const testSessionId = `${config.runId}-w${window.index}-oos`;
      const testConfig = this.buildOosConfig(window, best.params, config, testSessionId);
      const testResult = await this.backtestEngine.run(testConfig);

      const testMetricValue =
        testResult.state === BacktestState.COMPLETED && testResult.report
          ? this.optimizer.extractMetric(testResult.report, config.optimizationMetric)
          : 0;

      const decayRatio = best.metricValue !== 0 ? testMetricValue / best.metricValue : 0;

      windowResults.push({
        window,
        bestParams: best.params,
        bestTrainMetricValue: best.metricValue,
        trainResult: best.result,
        testResult,
        allCandidates: candidates,
        performanceDecayRatio: decayRatio,
      });

      this.logger.log(
        `Window ${window.index}: bestParams=${JSON.stringify(best.params)}, ` +
          `trainMetric=${best.metricValue.toFixed(3)}, testMetric=${testMetricValue.toFixed(3)}, ` +
          `decay=${decayRatio.toFixed(2)}`,
        this.context,
      );
    }

    const stability = this.stabilityAnalyzer.analyze(windowResults);
    const result = this.reportGenerator.generate(
      config,
      windowResults,
      stability,
      startedAt,
      totalOptimizationRuns,
    );

    this.logger.log(
      `Walk-forward ${config.runId} done: ${windowResults.length}/${windows.length} windows valid, ` +
        `OOS Sharpe=${result.combinedOosSharpe.toFixed(2)}, ` +
        `decay=${result.performanceDecayRatio.toFixed(2)}, ` +
        `robust=${result.isRobust}`,
      this.context,
    );

    return result;
  }

  private buildOosConfig(
    window: WalkForwardWindow,
    params: Record<string, number>,
    config: WalkForwardConfig,
    sessionId: string,
  ): BacktestConfig {
    return this.optimizer.buildConfig(
      window.testStartTime,
      window.testEndTime,
      params,
      config,
      sessionId,
    );
  }
}
