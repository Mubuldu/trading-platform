import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { AlertsConfig } from '@config/alerts.config';
import { Alert, RaiseAlertInput, RaiseAlertResult } from '../../domain/alert.entity';
import { AlertLevel } from '../../domain/alert-level.enum';
import { RECOVERY_CONDITION_MAP, isRecoveryCondition } from '../../domain/alert-condition.enum';
import { AlertRateLimiterService } from './alert-rate-limiter.service';
import { AlertEscalationService } from './alert-escalation.service';
import { AlertDispatcherService } from './alert-dispatcher.service';
import { AlertStoreService } from './alert-store.service';
import { AlertNotFoundError, AlertAlreadyResolvedError } from '../../domain/errors/alert.error';

/**
 * AlertEngineService is the single public API for the alerting subsystem.
 *
 * All callers — risk engine, execution engine, infrastructure health —
 * interact exclusively through this service.
 *
 * Design guarantees:
 *  1. Never throws — every public method catches all errors internally.
 *  2. Never blocks the caller — dispatch is fire-and-forget.
 *  3. Never interferes with trading — the calling thread is released
 *     before any network I/O begins.
 *  4. Idempotent on recovery — raising a recovery alert for an already-
 *     resolved condition is a no-op.
 *
 * Raise flow:
 *   raise(input)
 *     → compute fingerprint
 *     → check cooldown (Redis)
 *     │
 *     ├─ within cooldown:
 *     │    → increment suppressed count
 *     │    → evaluate escalation
 *     │    ├─ escalate: update level, reset cooldown, dispatch (async)
 *     │    └─ no escalate: return suppressed result
 *     │
 *     └─ outside cooldown (or no existing open alert):
 *          → persist new alert (or reopen closed one)
 *          → record cooldown
 *          → dispatch to channels (async, fire-and-forget)
 *          → return fresh result
 *
 * Recovery flow:
 *   raise({ condition: <RecoveryCondition> })
 *     → find matching open alert
 *     → auto-resolve it
 *     → dispatch recovery notification (async)
 *     → clear cooldown so next failure fires immediately
 */
@Injectable()
export class AlertEngineService implements OnModuleInit {
  private readonly context = AlertEngineService.name;

  private alertsEnabled = true;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
    private readonly rateLimiter: AlertRateLimiterService,
    private readonly escalation: AlertEscalationService,
    private readonly dispatcher: AlertDispatcherService,
    private readonly store: AlertStoreService,
  ) {}

  onModuleInit(): void {
    const cfg = this.configService.get<AlertsConfig>('alerts')!;
    this.alertsEnabled = cfg.enabled;

    this.logger.log(`AlertEngine initialized — enabled=${this.alertsEnabled}`, this.context);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Raise an alert.
   *
   * This is the primary entry point for all subsystems.
   *
   * @example
   * await alertEngine.raise({
   *   level: AlertLevel.CRITICAL,
   *   category: AlertCategory.EXCHANGE,
   *   condition: 'ExchangeDisconnect', // AlertCondition.EXCHANGE_DISCONNECT
   *   title: 'Binance disconnected',
   *   message: `WebSocket stream dropped after 3 missed heartbeats`,
   *   source: 'BinanceWsAdapter',
   *   context: { exchangeId: 'BINANCE_SPOT', attempt: 3 },
   * });
   */
  async raise(input: RaiseAlertInput): Promise<RaiseAlertResult | null> {
    if (!this.alertsEnabled) return null;

    try {
      if (isRecoveryCondition(input.condition)) {
        return await this.handleRecovery(input);
      }
      return await this.handleFailure(input);
    } catch (error) {
      // Absorb all errors — the engine must never impact trading
      this.logger.error(
        `AlertEngine.raise() unexpected error: ${(error as Error).message}`,
        (error as Error).stack,
        this.context,
      );
      return null;
    }
  }

  /**
   * Acknowledge an open alert.
   * Idempotent — already-acknowledged alerts are returned as-is.
   */
  async acknowledge(id: string, acknowledgedBy: string): Promise<Alert | null> {
    try {
      const result = await this.store.acknowledge({ id, acknowledgedBy });
      if (result instanceof AlertNotFoundError || result instanceof AlertAlreadyResolvedError) {
        this.logger.warn(`AlertEngine.acknowledge: ${result.message}`, this.context);
        return null;
      }
      return result;
    } catch (error) {
      this.logger.error(
        `AlertEngine.acknowledge() error: ${(error as Error).message}`,
        undefined,
        this.context,
      );
      return null;
    }
  }

  /**
   * Manually resolve an alert.
   * Clears the rate-limiter state so the next occurrence fires immediately.
   */
  async resolve(id: string, resolutionNote?: string, resolvedBy?: string): Promise<Alert | null> {
    try {
      const result = await this.store.resolve({ id, resolutionNote, resolvedBy });
      if (result instanceof AlertNotFoundError || result instanceof AlertAlreadyResolvedError) {
        this.logger.warn(`AlertEngine.resolve: ${result.message}`, this.context);
        return null;
      }
      // Clear rate-limiter so next occurrence is treated fresh
      void this.rateLimiter.clearCooldown(result.fingerprint);
      return result;
    } catch (error) {
      this.logger.error(
        `AlertEngine.resolve() error: ${(error as Error).message}`,
        undefined,
        this.context,
      );
      return null;
    }
  }

  // ── Failure path ──────────────────────────────────────────────────────────

  private async handleFailure(input: RaiseAlertInput): Promise<RaiseAlertResult> {
    const fingerprint = AlertRateLimiterService.buildFingerprint(
      input.category,
      input.condition,
      input.source,
    );

    const [cooldown, existingAlert] = await Promise.all([
      this.rateLimiter.checkCooldown(fingerprint),
      this.store.findOpenByFingerprint(fingerprint),
    ]);

    // ── Within cooldown — suppress or escalate ──────────────────────────────
    if (cooldown.suppressed && existingAlert) {
      const suppressedCount = await this.rateLimiter.incrementSuppressedCount(fingerprint);
      const escalationDecision = this.escalation.evaluate(existingAlert, suppressedCount);

      if (escalationDecision.shouldEscalate) {
        return this.doEscalate(existingAlert, escalationDecision.targetLevel, suppressedCount);
      }

      // Pure suppression — update count in DB, return
      const suppressed: Alert = {
        ...existingAlert,
        suppressedCount,
        updatedAt: new Date(),
      };
      void this.store.update(suppressed);

      this.logger.debug(
        `AlertEngine: suppressed [${existingAlert.level}] "${existingAlert.title}" ` +
          `(cooldown ${cooldown.cooldownRemainingSeconds}s remaining, suppressed=${suppressedCount})`,
        this.context,
      );

      return { alert: suppressed, suppressed: true, notified: false, escalated: false };
    }

    // ── Outside cooldown — fire fresh alert ───────────────────────────────
    const now = new Date();
    const alert: Alert = {
      id: randomUUID(),
      level: input.level,
      category: input.category,
      condition: input.condition,
      title: input.title,
      message: input.message,
      source: input.source,
      fingerprint,
      status: 'open',
      context: input.context ?? {},
      suppressedCount: 0,
      escalationCount: 0,
      notificationChannels: [],
      notificationSentAt: null,
      acknowledgedBy: null,
      acknowledgedAt: null,
      resolvedAt: null,
      resolutionNote: null,
      isRecovery: false,
      createdAt: now,
      updatedAt: now,
    };

    const saved = await this.store.save(alert);
    const target = saved ?? alert;

    // Record cooldown BEFORE dispatch so concurrent raises are rate-limited
    void this.rateLimiter.recordRaise(fingerprint);

    // Dispatch fire-and-forget — never awaited by the caller
    void this.dispatchAndUpdate(target);

    this.logger.log(
      `AlertEngine: raised [${alert.level}] "${alert.title}" (${alert.category}/${alert.condition})`,
      this.context,
    );

    return { alert: target, suppressed: false, notified: true, escalated: false };
  }

  // ── Escalation path ───────────────────────────────────────────────────────

  private async doEscalate(
    existing: Alert,
    targetLevel: AlertLevel,
    suppressedCount: number,
  ): Promise<RaiseAlertResult> {
    const escalated = this.escalation.escalate({ ...existing, suppressedCount }, targetLevel);

    const saved = await this.store.update(escalated);
    const target = saved ?? escalated;

    // Reset cooldown at the new (higher) level — fires a fresh notification
    void this.rateLimiter.recordRaise(escalated.fingerprint);
    void this.dispatchAndUpdate(target);

    this.logger.warn(
      `AlertEngine: escalated [${existing.level}→${targetLevel}] "${existing.title}"`,
      this.context,
    );

    return { alert: target, suppressed: true, notified: true, escalated: true };
  }

  // ── Recovery path ─────────────────────────────────────────────────────────

  private async handleRecovery(input: RaiseAlertInput): Promise<RaiseAlertResult> {
    // Find the base condition this recovery resolves
    const baseCondition = RECOVERY_CONDITION_MAP[input.condition];

    let autoResolved: Alert | null = null;
    if (baseCondition) {
      const openAlert = await this.store.findOpenByCondition(
        input.category,
        baseCondition,
        input.source,
      );

      if (openAlert) {
        const resolveResult = await this.store.resolve({
          id: openAlert.id,
          resolutionNote: `Auto-resolved by recovery event: ${input.condition}`,
        });
        if (
          !(resolveResult instanceof AlertNotFoundError) &&
          !(resolveResult instanceof AlertAlreadyResolvedError)
        ) {
          autoResolved = resolveResult;
          void this.rateLimiter.clearCooldown(openAlert.fingerprint);
          this.logger.log(
            `AlertEngine: auto-resolved alert ${openAlert.id} via recovery ${input.condition}`,
            this.context,
          );
        }
      }
    }

    // Persist the recovery notification itself
    const fingerprint = AlertRateLimiterService.buildFingerprint(
      input.category,
      input.condition,
      input.source,
    );

    const now = new Date();
    const recoveryAlert: Alert = {
      id: randomUUID(),
      level: input.level,
      category: input.category,
      condition: input.condition,
      title: input.title,
      message: input.message,
      source: input.source,
      fingerprint,
      status: 'resolved', // recovery alerts start resolved
      context: { ...input.context, resolvedAlertId: autoResolved?.id },
      suppressedCount: 0,
      escalationCount: 0,
      notificationChannels: [],
      notificationSentAt: null,
      acknowledgedBy: null,
      acknowledgedAt: null,
      resolvedAt: now,
      resolutionNote: null,
      isRecovery: true,
      createdAt: now,
      updatedAt: now,
    };

    const saved = await this.store.save(recoveryAlert);
    const target = saved ?? recoveryAlert;

    void this.dispatchAndUpdate(target);

    return { alert: target, suppressed: false, notified: true, escalated: false };
  }

  // ── Dispatch helper ───────────────────────────────────────────────────────

  /**
   * Dispatch to channels, then update the alert record with delivery results.
   * This is always fire-and-forget — never awaited by raise().
   */
  private async dispatchAndUpdate(alert: Alert): Promise<void> {
    try {
      const result = await this.dispatcher.dispatch(alert);
      const sentAt = new Date();

      const updated: Alert = {
        ...alert,
        notificationChannels: result.delivered,
        notificationSentAt: result.delivered.length > 0 ? sentAt : null,
        updatedAt: sentAt,
      };

      await this.store.update(updated);
    } catch (error) {
      // Best-effort — never propagate dispatch errors
      this.logger.warn(
        `AlertEngine.dispatchAndUpdate failed: ${(error as Error).message}`,
        this.context,
      );
    }
  }
}
