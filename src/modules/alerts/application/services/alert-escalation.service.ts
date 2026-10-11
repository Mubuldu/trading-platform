import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { AlertsConfig } from '@config/alerts.config';
import { Alert } from '../../domain/alert.entity';
import { AlertLevel, escalateLevel } from '../../domain/alert-level.enum';

export interface EscalationDecision {
  /** Whether the alert should be escalated to a higher level. */
  readonly shouldEscalate: boolean;
  /** The target level if escalation is warranted. */
  readonly targetLevel: AlertLevel;
}

/**
 * AlertEscalationService decides whether a repeatedly-suppressed alert
 * should be promoted to a higher severity level.
 *
 * Policy:
 *   After `escalationThreshold` suppressions within the escalation window,
 *   the alert level is incremented by one tier (up to FATAL).
 *
 *   After escalation the suppression counter resets (managed by the rate
 *   limiter) so the escalated alert fires fresh and re-starts its own
 *   cooldown cycle at the new level.
 *
 * Reasoning:
 *   A condition that keeps repeating despite rate limiting is more severe
 *   than one that fires once. Escalation ensures operators are woken for
 *   persistent failures even if the initial alert was routine.
 */
@Injectable()
export class AlertEscalationService {
  private readonly context = AlertEscalationService.name;

  private escalationThreshold: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {
    const cfg = this.configService.get<AlertsConfig>('alerts')!;
    this.escalationThreshold = cfg.escalationThreshold;
  }

  /**
   * Evaluate whether the given alert should be escalated.
   *
   * @param alert         The existing open alert being suppressed
   * @param suppressedCount The total suppressed count returned by the rate limiter
   */
  evaluate(alert: Alert, suppressedCount: number): EscalationDecision {
    // FATAL is already at maximum severity — no escalation possible.
    if (alert.level === AlertLevel.FATAL) {
      return { shouldEscalate: false, targetLevel: AlertLevel.FATAL };
    }

    // Escalate when suppressedCount hits a multiple of the threshold.
    // Multiples allow repeated escalation: INFO→WARNING→ERROR→CRITICAL→FATAL.
    if (suppressedCount > 0 && suppressedCount % this.escalationThreshold === 0) {
      const targetLevel = escalateLevel(alert.level);
      this.logger.warn(
        `Alert escalation: fingerprint=${alert.fingerprint} ` +
          `${alert.level}→${targetLevel} after ${suppressedCount} suppressions`,
        this.context,
      );
      return { shouldEscalate: true, targetLevel };
    }

    return { shouldEscalate: false, targetLevel: alert.level };
  }

  /**
   * Build an escalated copy of the alert.
   * The caller is responsible for persisting and notifying.
   */
  escalate(alert: Alert, targetLevel: AlertLevel): Alert {
    return {
      ...alert,
      level: targetLevel,
      escalationCount: alert.escalationCount + 1,
      message:
        `[Escalated ${alert.escalationCount + 1}×] ` +
        `${alert.message} (${alert.suppressedCount} occurrences suppressed)`,
      updatedAt: new Date(),
    };
  }
}
