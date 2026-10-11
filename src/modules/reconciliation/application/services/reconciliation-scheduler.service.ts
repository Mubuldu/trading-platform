import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { BackgroundTaskManager } from '@infrastructure/background/background-task-manager';
import { StreamPublisherService } from '@infrastructure/redis/streams/stream-publisher.service';
import { STREAM_NAMES } from '@infrastructure/redis/streams/stream-names.constants';
import { RiskStateService } from '@modules/risk/application/services/risk-state.service';
import { ReconciliationConfig } from '@config/reconciliation.config';
import { ReconciliationStatus, RecoveryAction } from '../../domain/enums/recovery-action.enum';
import { ReconciliationResult } from '../../domain/models/reconciliation-result.model';
import { PositionReconcilerService } from './position-reconciler.service';
import { OrderReconcilerService } from './order-reconciler.service';
import { RecoveryService } from './recovery.service';
import { ReconciliationMetricsService } from './reconciliation-metrics.service';
import { ReconciliationAuditService } from './reconciliation-audit.service';

@Injectable()
export class ReconciliationSchedulerService implements OnModuleInit {
  private readonly context = ReconciliationSchedulerService.name;
  private readonly cfg: ReconciliationConfig;
  private lastResult: ReconciliationResult | null = null;
  private runCount = 0;

  constructor(
    configService: ConfigService,
    private readonly logger: AppLoggerService,
    private readonly taskManager: BackgroundTaskManager,
    private readonly publisher: StreamPublisherService,
    private readonly riskState: RiskStateService,
    private readonly positionReconciler: PositionReconcilerService,
    private readonly orderReconciler: OrderReconcilerService,
    private readonly recovery: RecoveryService,
    private readonly metricsService: ReconciliationMetricsService,
    private readonly auditService: ReconciliationAuditService,
  ) {
    this.cfg = configService.get<ReconciliationConfig>('reconciliation')!;
  }

  onModuleInit(): void {
    if (!this.cfg.enabled) {
      this.logger.warn('Reconciliation engine is DISABLED', this.context);
      return;
    }

    this.taskManager.register({
      name: 'reconciliation-engine',
      fn: () => this.runCycle(),
      intervalMs: this.cfg.intervalMs,
      runImmediately: false,
      onError: (error, taskName) => {
        this.logger.error(
          `Reconciliation task "${taskName}" crashed: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
          this.context,
        );
      },
    });

    this.logger.log(
      `Reconciliation engine initialized — interval=${this.cfg.intervalMs}ms`,
      this.context,
    );
  }

  async runCycle(): Promise<void> {
    const runId = `recon-${Date.now()}-${++this.runCount}`;
    const startedAt = Date.now();

    let result: ReconciliationResult;

    try {
      const [positionMismatches, orderMismatches] = await Promise.all([
        this.positionReconciler.reconcile(),
        this.orderReconciler.reconcile(),
      ]);

      const totalMismatches = positionMismatches.length + orderMismatches.length;

      if (totalMismatches === 0) {
        const completedAt = Date.now();
        result = {
          runId,
          startedAt,
          completedAt,
          durationMs: completedAt - startedAt,
          status: ReconciliationStatus.CLEAN,
          positionMismatches: [],
          orderMismatches: [],
          totalMismatches: 0,
          autoRecovered: 0,
          manualRequired: 0,
          error: null,
        };
        this.lastResult = result;
        this.metricsService.recordRunComplete(result.durationMs);
        return;
      }

      // Mismatch detected — pause trading if configured
      this.logger.warn(
        `[RECONCILIATION] Mismatch detected — runId=${runId} ` +
          `positions=${positionMismatches.length} orders=${orderMismatches.length}`,
        this.context,
      );

      this.metricsService.recordMismatch(positionMismatches.length, orderMismatches.length);

      if (this.cfg.pauseTradingOnMismatch) {
        this.riskState.pauseTrading();
        this.metricsService.recordTradingPaused();
        this.logger.warn(
          `[RECONCILIATION] Trading PAUSED due to state mismatch (runId=${runId})`,
          this.context,
        );
      }

      // Run recovery
      const [positionOutcomes, orderOutcomes] = await Promise.all([
        this.recovery.recoverPositions(positionMismatches),
        this.recovery.recoverOrders(orderMismatches),
      ]);

      const allOutcomes = [...positionOutcomes, ...orderOutcomes];
      const autoRecovered = allOutcomes.filter((o) => o.succeeded && !o.requiresManual).length;
      const manualRequired = allOutcomes.filter((o) => o.requiresManual).length;

      const completedAt = Date.now();
      const status =
        manualRequired > 0
          ? ReconciliationStatus.MANUAL_INTERVENTION_REQUIRED
          : autoRecovered === totalMismatches
            ? ReconciliationStatus.RECOVERED
            : ReconciliationStatus.MISMATCH_DETECTED;

      result = {
        runId,
        startedAt,
        completedAt,
        durationMs: completedAt - startedAt,
        status,
        positionMismatches,
        orderMismatches,
        totalMismatches,
        autoRecovered,
        manualRequired,
        error: null,
      };

      // Resume trading only if all mismatches were auto-recovered
      if (manualRequired === 0 && this.cfg.pauseTradingOnMismatch) {
        this.riskState.resume();
        this.logger.log(
          `[RECONCILIATION] Trading RESUMED — all mismatches auto-recovered (runId=${runId})`,
          this.context,
        );
      } else if (manualRequired > 0) {
        // Log all manual items needing attention
        const manualMismatches = [
          ...positionMismatches.filter((m) => m.recoveryAction === RecoveryAction.MANUAL_REQUIRED),
          ...orderMismatches.filter((m) => m.recoveryAction === RecoveryAction.MANUAL_REQUIRED),
        ];
        await this.auditService.logManualInterventionRequired(manualMismatches);
      }

      await this.auditService.logRunResult(result);
      await this.publishAlert(result);
    } catch (e) {
      const completedAt = Date.now();
      result = {
        runId,
        startedAt,
        completedAt,
        durationMs: completedAt - startedAt,
        status: ReconciliationStatus.ERROR,
        positionMismatches: [],
        orderMismatches: [],
        totalMismatches: 0,
        autoRecovered: 0,
        manualRequired: 0,
        error: (e as Error).message,
      };

      this.logger.error(
        `Reconciliation cycle failed (runId=${runId}): ${(e as Error).message}`,
        (e as Error).stack,
        this.context,
      );
    }

    this.lastResult = result;
    this.metricsService.recordRunComplete(result.durationMs);
  }

  getLastResult(): ReconciliationResult | null {
    return this.lastResult;
  }

  isClean(): boolean {
    return this.lastResult?.status === ReconciliationStatus.CLEAN;
  }

  private async publishAlert(result: ReconciliationResult): Promise<void> {
    try {
      await this.publisher.publish(STREAM_NAMES.RECONCILIATION_ALERT, {
        correlationId: result.runId,
        eventType: 'ReconciliationAlert',
        exchange: 'all',
        symbol: 'all',
        timestamp: result.completedAt,
        producer: this.context,
        payload: {
          runId: result.runId,
          status: result.status,
          totalMismatches: result.totalMismatches,
          autoRecovered: result.autoRecovered,
          manualRequired: result.manualRequired,
          durationMs: result.durationMs,
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
    } catch (e) {
      this.logger.error(
        `Failed to publish reconciliation alert: ${(e as Error).message}`,
        undefined,
        this.context,
      );
    }
  }
}
