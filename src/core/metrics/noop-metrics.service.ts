import { Injectable } from '@nestjs/common';
import { IMetrics } from './metrics.interface';

/**
 * NoopMetricsService is the default implementation when no metrics backend
 * is configured. All methods are intentional no-ops.
 *
 * This is NOT a placeholder — it is a valid, production-safe implementation
 * for environments where metrics are not required (unit tests, minimal deploys).
 * It satisfies the IMetrics interface contract by doing nothing, which is
 * correct behavior for "no metrics backend configured."
 */
@Injectable()
export class NoopMetricsService implements IMetrics {
  increment(_metric: string, _value?: number, _tags?: Record<string, string>): void {}
  decrement(_metric: string, _value?: number, _tags?: Record<string, string>): void {}
  gauge(_metric: string, _value: number, _tags?: Record<string, string>): void {}
  histogram(_metric: string, _value: number, _tags?: Record<string, string>): void {}
  timing(_metric: string, _durationMs: number, _tags?: Record<string, string>): void {}

  startTimer(_metric: string, _tags?: Record<string, string>): () => void {
    return (): void => {};
  }
}
