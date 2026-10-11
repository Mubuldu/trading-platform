import { ParameterStabilityReport } from './parameter-stability.model';
import { WalkForwardConfig } from './walk-forward-config.model';
import { WalkForwardWindowResult } from './walk-forward-window-result.model';

export interface WalkForwardResult {
  readonly runId: string;
  readonly config: WalkForwardConfig;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly durationMs: number;

  readonly windows: WalkForwardWindowResult[];
  readonly totalWindowsRun: number;
  readonly totalOptimizationRuns: number;

  readonly combinedOosSharpe: number;
  readonly combinedOosSortino: number;
  readonly combinedOosNetProfit: number;
  readonly combinedOosNetProfitPercent: number;
  readonly combinedOosProfitFactor: number;
  readonly combinedOosWinRate: number;
  readonly combinedOosMaxDrawdown: number;
  readonly combinedOosExpectancy: number;
  readonly totalOosTrades: number;

  readonly combinedTrainSharpe: number;
  readonly combinedTrainNetProfitPercent: number;

  readonly performanceDecayRatio: number;

  readonly parameterStability: ParameterStabilityReport;

  readonly isRobust: boolean;
  readonly robustnessReason: string;
}
