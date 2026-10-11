import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { PositionMismatch } from '../../domain/models/position-mismatch.model';
import { OrderMismatch } from '../../domain/models/order-mismatch.model';
import { RecoveryAction } from '../../domain/enums/recovery-action.enum';
import { PositionMismatchType } from '../../domain/enums/mismatch-type.enum';
import { ReconciliationAuditService } from './reconciliation-audit.service';
import { ReconciliationMetricsService } from './reconciliation-metrics.service';

export interface RecoveryOutcome {
  readonly mismatch: PositionMismatch | OrderMismatch;
  readonly action: RecoveryAction;
  readonly succeeded: boolean;
  readonly requiresManual: boolean;
  readonly detail: string;
}

@Injectable()
export class RecoveryService {
  private readonly context = RecoveryService.name;

  constructor(
    private readonly logger: AppLoggerService,
    private readonly auditService: ReconciliationAuditService,
    private readonly metrics: ReconciliationMetricsService,
  ) {}

  async recoverPositions(mismatches: PositionMismatch[]): Promise<RecoveryOutcome[]> {
    const outcomes: RecoveryOutcome[] = [];

    for (const mismatch of mismatches) {
      const outcome = await this.recoverPosition(mismatch);
      outcomes.push(outcome);
    }

    return outcomes;
  }

  async recoverOrders(mismatches: OrderMismatch[]): Promise<RecoveryOutcome[]> {
    const outcomes: RecoveryOutcome[] = [];

    for (const mismatch of mismatches) {
      const outcome = await this.recoverOrder(mismatch);
      outcomes.push(outcome);
    }

    return outcomes;
  }

  private async recoverPosition(mismatch: PositionMismatch): Promise<RecoveryOutcome> {
    if (mismatch.recoveryAction === RecoveryAction.MANUAL_REQUIRED) {
      this.logger.warn(
        `[MANUAL REQUIRED] Position ${mismatch.symbol}: ${mismatch.type} — ` +
          `internal=${mismatch.internalValue} exchange=${mismatch.exchangeValue}`,
        this.context,
      );
      this.metrics.recordManualIntervention();
      await this.auditService.logPositionMismatch(mismatch, 'manual_intervention_required');
      return {
        mismatch,
        action: RecoveryAction.MANUAL_REQUIRED,
        succeeded: false,
        requiresManual: true,
        detail: `Large mismatch on ${mismatch.type} for ${mismatch.symbol} requires manual review`,
      };
    }

    if (mismatch.recoveryAction === RecoveryAction.NO_ACTION) {
      return {
        mismatch,
        action: RecoveryAction.NO_ACTION,
        succeeded: true,
        requiresManual: false,
        detail: 'Diff within tolerance — no action taken',
      };
    }

    // SYNC_FROM_EXCHANGE — for small diffs only
    if (mismatch.type === PositionMismatchType.GHOST_POSITION) {
      return await this.handleGhostPosition(mismatch);
    }

    if (mismatch.type === PositionMismatchType.MISSING_POSITION) {
      return await this.handleMissingPosition(mismatch);
    }

    // For quantity/price diffs that are small: log and accept exchange state
    try {
      this.logger.log(
        `[AUTO SYNC] Position ${mismatch.symbol} ${mismatch.type}: ` +
          `internal=${mismatch.internalValue} → exchange=${mismatch.exchangeValue}`,
        this.context,
      );
      this.metrics.recordRecoverySuccess();
      await this.auditService.logPositionMismatch(mismatch, 'synced_from_exchange');
      return {
        mismatch,
        action: RecoveryAction.SYNC_FROM_EXCHANGE,
        succeeded: true,
        requiresManual: false,
        detail: `Auto-synced ${mismatch.type} for ${mismatch.symbol} from exchange`,
      };
    } catch (e) {
      this.logger.error(
        `Recovery failed for position ${mismatch.symbol}: ${(e as Error).message}`,
        undefined,
        this.context,
      );
      this.metrics.recordRecoveryFailure();
      await this.auditService.logPositionMismatch(mismatch, 'recovery_failed');
      return {
        mismatch,
        action: RecoveryAction.SYNC_FROM_EXCHANGE,
        succeeded: false,
        requiresManual: true,
        detail: `Auto-recovery failed: ${(e as Error).message}`,
      };
    }
  }

  private async handleGhostPosition(mismatch: PositionMismatch): Promise<RecoveryOutcome> {
    this.logger.warn(
      `[GHOST POSITION] ${mismatch.symbol} exists on exchange (qty=${mismatch.exchangeValue}) ` +
        `but is not tracked internally`,
      this.context,
    );

    if (mismatch.recoveryAction === RecoveryAction.MANUAL_REQUIRED) {
      this.metrics.recordManualIntervention();
      await this.auditService.logPositionMismatch(mismatch, 'ghost_position_manual_required');
      return {
        mismatch,
        action: RecoveryAction.MANUAL_REQUIRED,
        succeeded: false,
        requiresManual: true,
        detail: `Ghost position ${mismatch.symbol} too large for auto-sync`,
      };
    }

    this.metrics.recordRecoverySuccess();
    await this.auditService.logPositionMismatch(mismatch, 'ghost_position_flagged_for_sync');
    return {
      mismatch,
      action: RecoveryAction.SYNC_FROM_EXCHANGE,
      succeeded: true,
      requiresManual: false,
      detail: `Ghost position ${mismatch.symbol} flagged — will be absorbed on next fill`,
    };
  }

  private async handleMissingPosition(mismatch: PositionMismatch): Promise<RecoveryOutcome> {
    this.logger.warn(
      `[MISSING POSITION] ${mismatch.symbol} tracked internally (qty=${mismatch.internalValue}) ` +
        `but not present on exchange`,
      this.context,
    );

    if (mismatch.recoveryAction === RecoveryAction.MANUAL_REQUIRED) {
      this.metrics.recordManualIntervention();
      await this.auditService.logPositionMismatch(mismatch, 'missing_position_manual_required');
      return {
        mismatch,
        action: RecoveryAction.MANUAL_REQUIRED,
        succeeded: false,
        requiresManual: true,
        detail: `Missing position ${mismatch.symbol} is large — manual review required`,
      };
    }

    this.metrics.recordRecoverySuccess();
    await this.auditService.logPositionMismatch(mismatch, 'missing_position_within_tolerance');
    return {
      mismatch,
      action: RecoveryAction.SYNC_FROM_EXCHANGE,
      succeeded: true,
      requiresManual: false,
      detail: `Missing position ${mismatch.symbol} within tolerance — accepted as closed`,
    };
  }

  private async recoverOrder(mismatch: OrderMismatch): Promise<RecoveryOutcome> {
    if (mismatch.recoveryAction === RecoveryAction.MANUAL_REQUIRED) {
      this.logger.warn(
        `[MANUAL REQUIRED] Order ${mismatch.clientOrderId ?? mismatch.exchangeOrderId}: ${mismatch.type}`,
        this.context,
      );
      this.metrics.recordManualIntervention();
      await this.auditService.logOrderMismatch(mismatch, 'manual_intervention_required');
      return {
        mismatch,
        action: RecoveryAction.MANUAL_REQUIRED,
        succeeded: false,
        requiresManual: true,
        detail: `Order ${mismatch.type} requires manual review`,
      };
    }

    try {
      this.logger.log(
        `[AUTO SYNC] Order ${mismatch.clientOrderId ?? mismatch.exchangeOrderId} ${mismatch.type} — syncing`,
        this.context,
      );
      this.metrics.recordRecoverySuccess();
      await this.auditService.logOrderMismatch(mismatch, 'synced_from_exchange');
      return {
        mismatch,
        action: RecoveryAction.SYNC_FROM_EXCHANGE,
        succeeded: true,
        requiresManual: false,
        detail: `Auto-synced order ${mismatch.type}`,
      };
    } catch (e) {
      this.logger.error(`Order recovery failed: ${(e as Error).message}`, undefined, this.context);
      this.metrics.recordRecoveryFailure();
      await this.auditService.logOrderMismatch(mismatch, 'recovery_failed');
      return {
        mismatch,
        action: RecoveryAction.SYNC_FROM_EXCHANGE,
        succeeded: false,
        requiresManual: true,
        detail: `Auto-recovery failed: ${(e as Error).message}`,
      };
    }
  }
}
