import { BacktestResult } from '@modules/backtest/domain/models/backtest-result.model';

export interface OptimizationCandidate {
  readonly params: Record<string, number>;
  readonly metricValue: number;
  readonly result: BacktestResult;
}
