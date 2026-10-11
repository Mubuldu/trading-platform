import { Injectable } from '@nestjs/common';
import { AuditService } from '@infrastructure/database/audit/audit.service';
import { PositionMismatch } from '../../domain/models/position-mismatch.model';
import { OrderMismatch } from '../../domain/models/order-mismatch.model';
import { ReconciliationResult } from '../../domain/models/reconciliation-result.model';
import { RecoveryAction } from '../../domain/enums/recovery-action.enum';

@Injectable()
export class ReconciliationAuditService {
  constructor(private readonly audit: AuditService) {}

  async logPositionMismatch(mismatch: PositionMismatch, recoveryOutcome: string): Promise<void> {
    await this.audit.log({
      tableName: 'positions',
      recordId: mismatch.symbol,
      operation: 'UPDATE',
      actor: 'reconciliation-engine',
      reason: `Position mismatch detected: ${mismatch.type}`,
      oldValue: mismatch.internal,
      newValue: {
        exchange: mismatch.exchange,
        recoveryAction: mismatch.recoveryAction,
        recoveryOutcome,
        detectedAt: mismatch.detectedAt,
      },
    });
  }

  async logOrderMismatch(mismatch: OrderMismatch, recoveryOutcome: string): Promise<void> {
    await this.audit.log({
      tableName: 'orders',
      recordId: mismatch.clientOrderId ?? mismatch.exchangeOrderId ?? 'unknown',
      operation: 'UPDATE',
      actor: 'reconciliation-engine',
      reason: `Order mismatch detected: ${mismatch.type}`,
      oldValue: mismatch.internal,
      newValue: {
        exchange: mismatch.exchange,
        recoveryAction: mismatch.recoveryAction,
        recoveryOutcome,
        detectedAt: mismatch.detectedAt,
      },
    });
  }

  async logRunResult(result: ReconciliationResult): Promise<void> {
    if (result.totalMismatches === 0) return;

    await this.audit.log({
      tableName: 'audit_logs',
      recordId: result.runId,
      operation: 'INSERT',
      actor: 'reconciliation-engine',
      reason: `Reconciliation run completed: ${result.status}`,
      oldValue: null,
      newValue: {
        runId: result.runId,
        status: result.status,
        durationMs: result.durationMs,
        totalMismatches: result.totalMismatches,
        autoRecovered: result.autoRecovered,
        manualRequired: result.manualRequired,
        positionMismatches: result.positionMismatches.map((m) => ({
          symbol: m.symbol,
          type: m.type,
          recoveryAction: m.recoveryAction,
        })),
        orderMismatches: result.orderMismatches.map((m) => ({
          clientOrderId: m.clientOrderId,
          type: m.type,
          recoveryAction: m.recoveryAction,
        })),
      },
    });
  }

  async logManualInterventionRequired(
    mismatches: Array<PositionMismatch | OrderMismatch>,
  ): Promise<void> {
    const events = mismatches
      .filter((m) => m.recoveryAction === RecoveryAction.MANUAL_REQUIRED)
      .map((m) => ({
        tableName: 'audit_logs',
        recordId: m.symbol,
        operation: 'INSERT' as const,
        actor: 'reconciliation-engine',
        reason: 'Manual intervention required — large mismatch detected',
        oldValue: null,
        newValue: m,
      }));

    if (events.length > 0) {
      await this.audit.logBatch(events);
    }
  }
}
