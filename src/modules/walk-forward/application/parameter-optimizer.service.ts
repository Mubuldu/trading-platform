import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { BacktestEngineService } from '@modules/backtest/application/engine/backtest-engine.service';
import { BacktestConfig } from '@modules/backtest/domain/models/backtest-config.model';
import { BacktestState } from '@modules/backtest/domain/enums/backtest-state.enum';
import { PerformanceReport } from '@modules/backtest/domain/models/performance-report.model';
import { OptimizationMetric } from '../domain/enums/optimization-metric.enum';
import { OptimizationCandidate } from '../domain/models/optimization-candidate.model';
import { ParameterGrid, WalkForwardConfig } from '../domain/models/walk-forward-config.model';
import { WalkForwardWindow } from '../domain/models/walk-forward-window.model';

export interface OptimizationResult {
  readonly candidates: OptimizationCandidate[];
  readonly totalAttempted: number;
}

@Injectable()
export class ParameterOptimizerService {
  private readonly context = ParameterOptimizerService.name;

  constructor(
    private readonly backtestEngine: BacktestEngineService,
    private readonly logger: AppLoggerService,
  ) {}

  async optimize(
    window: WalkForwardWindow,
    wfConfig: WalkForwardConfig,
  ): Promise<OptimizationResult> {
    const combinations = this.expandGrid(wfConfig.parameterGrid);
    const candidates: OptimizationCandidate[] = [];

    this.logger.log(
      `Window ${window.index}: running ${combinations.length} parameter combinations`,
      this.context,
    );

    for (let i = 0; i < combinations.length; i++) {
      const params = combinations[i];
      const sessionId = `${wfConfig.runId}-w${window.index}-c${i}`;
      const config = this.buildConfig(
        window.trainStartTime,
        window.trainEndTime,
        params,
        wfConfig,
        sessionId,
      );

      const result = await this.backtestEngine.run(config);

      if (result.state !== BacktestState.COMPLETED || !result.report) continue;
      if (result.report.totalTrades < wfConfig.minTradesRequired) continue;
      if (
        wfConfig.maxDrawdownFilterPercent !== undefined &&
        result.report.maxDrawdownPercent > wfConfig.maxDrawdownFilterPercent
      )
        continue;

      const metricValue = this.extractMetric(result.report, wfConfig.optimizationMetric);
      candidates.push({ params, metricValue, result });
    }

    candidates.sort((a, b) => b.metricValue - a.metricValue);

    return { candidates, totalAttempted: combinations.length };
  }

  extractMetric(report: PerformanceReport, metric: OptimizationMetric): number {
    switch (metric) {
      case OptimizationMetric.SHARPE:
        return report.sharpeRatio;
      case OptimizationMetric.SORTINO:
        return report.sortinoRatio;
      case OptimizationMetric.NET_PROFIT:
        return report.totalReturn;
      case OptimizationMetric.PROFIT_FACTOR:
        return isFinite(report.profitFactor) ? report.profitFactor : 0;
      case OptimizationMetric.WIN_RATE:
        return report.winRate;
      case OptimizationMetric.CALMAR:
        return report.calmarRatio;
      case OptimizationMetric.EXPECTANCY:
        return this.computeExpectancy(report);
    }
  }

  buildConfig(
    startTime: number,
    endTime: number,
    params: Record<string, number>,
    wfConfig: WalkForwardConfig,
    sessionId: string,
  ): BacktestConfig {
    const mergedParams = { ...wfConfig.baseStrategyConfig.parameters, ...params };
    const mergedStrategyConfig = { ...wfConfig.baseStrategyConfig, parameters: mergedParams };
    return {
      ...wfConfig.baseBacktestConfig,
      sessionId,
      startTime,
      endTime,
      strategies: [{ strategyType: wfConfig.strategyType, config: mergedStrategyConfig }],
    };
  }

  expandGrid(grid: ParameterGrid): Record<string, number>[] {
    const keys = Object.keys(grid);
    if (keys.length === 0) return [{}];

    let combinations: Record<string, number>[] = [{}];

    for (const key of keys) {
      const values = grid[key];
      const expanded: Record<string, number>[] = [];
      for (const combo of combinations) {
        for (const val of values) {
          expanded.push({ ...combo, [key]: val });
        }
      }
      combinations = expanded;
    }

    return combinations;
  }

  private computeExpectancy(report: PerformanceReport): number {
    if (report.totalTrades === 0) return 0;
    const avgLoss = report.averageLoss <= 0 ? report.averageLoss : -report.averageLoss;
    return report.winRate * report.averageWin + (1 - report.winRate) * avgLoss;
  }
}
