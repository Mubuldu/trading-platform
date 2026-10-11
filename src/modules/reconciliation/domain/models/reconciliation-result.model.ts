import { ReconciliationStatus } from '../enums/recovery-action.enum';
import { PositionMismatch } from './position-mismatch.model';
import { OrderMismatch } from './order-mismatch.model';

export interface ReconciliationResult {
  readonly runId: string;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly durationMs: number;
  readonly status: ReconciliationStatus;
  readonly positionMismatches: PositionMismatch[];
  readonly orderMismatches: OrderMismatch[];
  readonly totalMismatches: number;
  readonly autoRecovered: number;
  readonly manualRequired: number;
  readonly error: string | null;
}
