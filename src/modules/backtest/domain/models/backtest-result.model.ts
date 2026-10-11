import { BacktestState } from '../enums/backtest-state.enum';
import { BacktestConfig } from './backtest-config.model';
import { PerformanceReport } from './performance-report.model';

export interface BacktestResult {
  readonly sessionId: string;
  readonly config: BacktestConfig;
  readonly state: BacktestState;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly durationMs: number;
  readonly candlesProcessed: number;
  readonly errorMessage?: string;
  readonly report?: PerformanceReport;
}
