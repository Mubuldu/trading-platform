import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { Alert, AlertStatus } from '../../domain/alert.entity';
import { AlertLevel } from '../../domain/alert-level.enum';
import { AlertCategory } from '../../domain/alert-category.enum';
import { AlertCondition } from '../../domain/alert-condition.enum';
import {
  AlertRepository,
  AlertQueryOptions,
} from '../../infrastructure/repository/alert.repository';
import { AlertNotFoundError, AlertAlreadyResolvedError } from '../../domain/errors/alert.error';

export interface AcknowledgeAlertInput {
  readonly id: string;
  readonly acknowledgedBy: string;
}

export interface ResolveAlertInput {
  readonly id: string;
  readonly resolutionNote?: string;
  readonly resolvedBy?: string;
}

export interface AlertSummary {
  readonly openByLevel: Record<string, number>;
  readonly totalOpen: number;
  readonly totalAcknowledged: number;
  readonly totalResolved: number;
}

/**
 * AlertStoreService is the application-layer façade for alert persistence.
 *
 * Responsibilities:
 *  - Save new alerts (delegates to repository)
 *  - Acknowledge and resolve alerts with validation
 *  - Query by status / level / category
 *  - Provide open-alert summaries for the health subsystem
 *
 * Never throws — all public methods catch errors and return null / empty on
 * failure so the engine's control flow is never interrupted.
 */
@Injectable()
export class AlertStoreService {
  private readonly context = AlertStoreService.name;

  constructor(
    private readonly repository: AlertRepository,
    private readonly logger: AppLoggerService,
  ) {}

  // ── Write ──────────────────────────────────────────────────────────────────

  async save(alert: Alert): Promise<Alert | null> {
    const result = await this.repository.save(alert);
    if (result.isErr()) {
      this.logger.error(
        `AlertStore: failed to save alert ${alert.id} — ${result.error.message}`,
        undefined,
        this.context,
      );
      return null;
    }
    return result.value;
  }

  async update(alert: Alert): Promise<Alert | null> {
    const result = await this.repository.update(alert);
    if (result.isErr()) {
      this.logger.error(
        `AlertStore: failed to update alert ${alert.id} — ${result.error.message}`,
        undefined,
        this.context,
      );
      return null;
    }
    return result.value;
  }

  async acknowledge(
    input: AcknowledgeAlertInput,
  ): Promise<Alert | AlertNotFoundError | AlertAlreadyResolvedError> {
    const found = await this.repository.findById(input.id);
    if (found.isErr()) return new AlertNotFoundError(input.id);

    const alert = found.value;
    if (alert.status === 'resolved') return new AlertAlreadyResolvedError(input.id);
    if (alert.status === 'acknowledged') return alert; // idempotent

    const updated: Alert = {
      ...alert,
      status: 'acknowledged' as AlertStatus,
      acknowledgedBy: input.acknowledgedBy,
      acknowledgedAt: new Date(),
      updatedAt: new Date(),
    };

    return (await this.update(updated)) ?? alert;
  }

  async resolve(
    input: ResolveAlertInput,
  ): Promise<Alert | AlertNotFoundError | AlertAlreadyResolvedError> {
    const found = await this.repository.findById(input.id);
    if (found.isErr()) return new AlertNotFoundError(input.id);

    const alert = found.value;
    if (alert.status === 'resolved') return new AlertAlreadyResolvedError(input.id);

    const now = new Date();
    const updated: Alert = {
      ...alert,
      status: 'resolved' as AlertStatus,
      resolvedAt: now,
      resolutionNote: input.resolutionNote ?? null,
      acknowledgedBy: input.resolvedBy ?? alert.acknowledgedBy,
      acknowledgedAt: alert.acknowledgedAt ?? (input.resolvedBy ? now : null),
      updatedAt: now,
    };

    return (await this.update(updated)) ?? alert;
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  async findById(id: string): Promise<Alert | null> {
    const result = await this.repository.findById(id);
    return result.isOk() ? result.value : null;
  }

  async findOpenByFingerprint(fingerprint: string): Promise<Alert | null> {
    const result = await this.repository.findOpenByFingerprint(fingerprint);
    return result.isOk() ? result.value : null;
  }

  async findOpenByCondition(
    category: AlertCategory,
    condition: AlertCondition,
    source: string,
  ): Promise<Alert | null> {
    const result = await this.repository.findOpenByCondition(category, condition, source);
    return result.isOk() ? result.value : null;
  }

  async findMany(options: AlertQueryOptions = {}): Promise<Alert[]> {
    const result = await this.repository.findMany(options);
    if (result.isErr()) {
      this.logger.error(
        `AlertStore: findMany failed — ${result.error.message}`,
        undefined,
        this.context,
      );
      return [];
    }
    return result.value;
  }

  async findOpen(level?: AlertLevel, category?: AlertCategory): Promise<Alert[]> {
    return this.findMany({ status: 'open', level, category, limit: 500 });
  }

  async getSummary(): Promise<AlertSummary> {
    try {
      const countResult = await this.repository.countOpenByLevel();
      const openByLevel = countResult.isOk() ? countResult.value : {};
      const totalOpen = Object.values(openByLevel).reduce((a, b) => a + b, 0);

      const [acknowledged, resolved] = await Promise.all([
        this.findMany({ status: 'acknowledged', limit: 1 }),
        this.findMany({ status: 'resolved', limit: 1 }),
      ]);

      // For full counts, use DB aggregates (simplified here to avoid N+1)
      const ackResult = await this.repository.findMany({ status: 'acknowledged' });
      const resResult = await this.repository.findMany({ status: 'resolved' });

      return {
        openByLevel,
        totalOpen,
        totalAcknowledged: ackResult.isOk() ? ackResult.value.length : acknowledged.length,
        totalResolved: resResult.isOk() ? resResult.value.length : resolved.length,
      };
    } catch (error) {
      this.logger.error(
        `AlertStore: getSummary failed — ${(error as Error).message}`,
        undefined,
        this.context,
      );
      return { openByLevel: {}, totalOpen: 0, totalAcknowledged: 0, totalResolved: 0 };
    }
  }
}
