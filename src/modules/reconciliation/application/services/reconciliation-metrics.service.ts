import { Injectable, Inject } from '@nestjs/common';
import { IMetrics, METRICS_TOKEN } from '@core/metrics/metrics.interface';

const M = {
  RUN_TOTAL: 'reconciliation.run.total',
  RUN_DURATION_MS: 'reconciliation.run.duration_ms',
  MISMATCH_TOTAL: 'reconciliation.mismatch.total',
  RECOVERY_SUCCESS: 'reconciliation.recovery.success',
  RECOVERY_FAILURE: 'reconciliation.recovery.failure',
  MANUAL_INTERVENTION: 'reconciliation.manual_intervention.total',
  TRADING_PAUSED: 'reconciliation.trading_paused.total',
  POSITION_MISMATCHES: 'reconciliation.position_mismatches',
  ORDER_MISMATCHES: 'reconciliation.order_mismatches',
} as const;

@Injectable()
export class ReconciliationMetricsService {
  constructor(@Inject(METRICS_TOKEN) private readonly metrics: IMetrics) {}

  recordRunComplete(durationMs: number): void {
    this.metrics.increment(M.RUN_TOTAL);
    this.metrics.timing(M.RUN_DURATION_MS, durationMs);
  }

  recordMismatch(positionCount: number, orderCount: number): void {
    const total = positionCount + orderCount;
    this.metrics.increment(M.MISMATCH_TOTAL, total);
    this.metrics.gauge(M.POSITION_MISMATCHES, positionCount);
    this.metrics.gauge(M.ORDER_MISMATCHES, orderCount);
  }

  recordRecoverySuccess(): void {
    this.metrics.increment(M.RECOVERY_SUCCESS);
  }

  recordRecoveryFailure(): void {
    this.metrics.increment(M.RECOVERY_FAILURE);
  }

  recordManualIntervention(): void {
    this.metrics.increment(M.MANUAL_INTERVENTION);
  }

  recordTradingPaused(): void {
    this.metrics.increment(M.TRADING_PAUSED);
  }
}
