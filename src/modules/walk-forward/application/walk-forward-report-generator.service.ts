import { Injectable } from '@nestjs/common';
import { PerformanceReport } from '@modules/backtest/domain/models/performance-report.model';
import { ParameterStabilityReport } from '../domain/models/parameter-stability.model';
import { WalkForwardConfig } from '../domain/models/walk-forward-config.model';
import { WalkForwardResult } from '../domain/models/walk-forward-result.model';
import { WalkForwardWindowResult } from '../domain/models/walk-forward-window-result.model';

@Injectable()
export class WalkForwardReportGeneratorService {
  generate(
    config: WalkForwardConfig,
    windowResults: WalkForwardWindowResult[],
    stability: ParameterStabilityReport,
    startedAt: number,
    totalOptimizationRuns: number,
  ): WalkForwardResult {
    const completedAt = Date.now();

    const validTestReports = windowResults
      .map((w) => w.testResult.report)
      .filter((r): r is PerformanceReport => r !== undefined);

    const validTrainReports = windowResults
      .map((w) => w.trainResult.report)
      .filter((r): r is PerformanceReport => r !== undefined);

    const combinedOosSharpe = this.avg(validTestReports.map((r) => r.sharpeRatio));
    const combinedOosSortino = this.avg(validTestReports.map((r) => r.sortinoRatio));
    const combinedOosNetProfit = this.sum(validTestReports.map((r) => r.totalReturn));
    const combinedOosNetProfitPercent = this.avg(validTestReports.map((r) => r.totalReturnPercent));
    const combinedOosProfitFactor = this.avg(
      validTestReports.map((r) => (isFinite(r.profitFactor) ? r.profitFactor : 0)),
    );
    const combinedOosWinRate = this.avg(validTestReports.map((r) => r.winRate));
    const combinedOosMaxDrawdown =
      validTestReports.length > 0
        ? Math.max(...validTestReports.map((r) => r.maxDrawdownPercent))
        : 0;
    const combinedOosExpectancy = this.avg(validTestReports.map((r) => this.computeExpectancy(r)));
    const totalOosTrades = this.sum(validTestReports.map((r) => r.totalTrades));

    const combinedTrainSharpe = this.avg(validTrainReports.map((r) => r.sharpeRatio));
    const combinedTrainNetProfitPercent = this.avg(
      validTrainReports.map((r) => r.totalReturnPercent),
    );

    const performanceDecayRatio =
      combinedTrainSharpe !== 0 ? combinedOosSharpe / combinedTrainSharpe : 0;

    const isRobust = performanceDecayRatio >= 0.5 && stability.overallStabilityScore >= 0.6;
    const robustnessReason = this.buildRobustnessReason(
      isRobust,
      performanceDecayRatio,
      stability.overallStabilityScore,
    );

    return {
      runId: config.runId,
      config,
      startedAt,
      completedAt,
      durationMs: completedAt - startedAt,
      windows: windowResults,
      totalWindowsRun: windowResults.length,
      totalOptimizationRuns,
      combinedOosSharpe,
      combinedOosSortino,
      combinedOosNetProfit,
      combinedOosNetProfitPercent,
      combinedOosProfitFactor,
      combinedOosWinRate,
      combinedOosMaxDrawdown,
      combinedOosExpectancy,
      totalOosTrades,
      combinedTrainSharpe,
      combinedTrainNetProfitPercent,
      performanceDecayRatio,
      parameterStability: stability,
      isRobust,
      robustnessReason,
    };
  }

  private avg(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private sum(values: number[]): number {
    return values.reduce((a, b) => a + b, 0);
  }

  private computeExpectancy(report: PerformanceReport): number {
    if (report.totalTrades === 0) return 0;
    const avgLoss = report.averageLoss <= 0 ? report.averageLoss : -report.averageLoss;
    return report.winRate * report.averageWin + (1 - report.winRate) * avgLoss;
  }

  private buildRobustnessReason(
    isRobust: boolean,
    decayRatio: number,
    stabilityScore: number,
  ): string {
    if (isRobust) {
      return (
        `Strategy is robust: decay ratio ${decayRatio.toFixed(2)} >= 0.5 ` +
        `and stability score ${stabilityScore.toFixed(2)} >= 0.6`
      );
    }
    const reasons: string[] = [];
    if (decayRatio < 0.5) {
      reasons.push(`heavy OOS performance decay (ratio: ${decayRatio.toFixed(2)} < 0.5)`);
    }
    if (stabilityScore < 0.6) {
      reasons.push(
        `unstable parameters across windows (score: ${stabilityScore.toFixed(2)} < 0.6)`,
      );
    }
    return `Strategy is NOT robust: ${reasons.join('; ')}`;
  }
}
