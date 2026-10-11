import { BacktestState } from '../../domain/enums/backtest-state.enum';
import { BacktestConfig } from '../../domain/models/backtest-config.model';
import { BacktestResult } from '../../domain/models/backtest-result.model';
import { PerformanceReport } from '../../domain/models/performance-report.model';

export class BacktestSession {
  readonly sessionId: string;
  readonly config: BacktestConfig;
  readonly startedAt: number;

  state: BacktestState = BacktestState.IDLE;
  candlesProcessed = 0;
  errorMessage?: string;
  completedAt?: number;

  constructor(config: BacktestConfig) {
    this.sessionId = config.sessionId;
    this.config = config;
    this.startedAt = Date.now();
  }

  toResult(report?: PerformanceReport): BacktestResult {
    const completedAt = this.completedAt ?? Date.now();
    return {
      sessionId: this.sessionId,
      config: this.config,
      state: this.state,
      startedAt: this.startedAt,
      completedAt,
      durationMs: completedAt - this.startedAt,
      candlesProcessed: this.candlesProcessed,
      errorMessage: this.errorMessage,
      report,
    };
  }

  markFailed(reason: string): void {
    this.state = BacktestState.FAILED;
    this.errorMessage = reason;
    this.completedAt = Date.now();
  }

  markCompleted(): void {
    this.state = BacktestState.COMPLETED;
    this.completedAt = Date.now();
  }
}
