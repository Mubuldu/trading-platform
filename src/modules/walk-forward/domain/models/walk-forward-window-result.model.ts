import { BacktestResult } from '@modules/backtest/domain/models/backtest-result.model';
import { OptimizationCandidate } from './optimization-candidate.model';
import { WalkForwardWindow } from './walk-forward-window.model';

export interface WalkForwardWindowResult {
  readonly window: WalkForwardWindow;
  readonly bestParams: Record<string, number>;
  readonly bestTrainMetricValue: number;
  readonly trainResult: BacktestResult;
  readonly testResult: BacktestResult;
  readonly allCandidates: OptimizationCandidate[];
  readonly performanceDecayRatio: number;
}
