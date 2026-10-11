import { AlertLevel } from './alert-level.enum';
import { AlertCategory } from './alert-category.enum';
import { AlertCondition } from './alert-condition.enum';

export type AlertStatus = 'open' | 'acknowledged' | 'resolved';

/**
 * Alert is the core domain entity representing a single alerting event.
 *
 * Lifecycle:
 *   open → acknowledged → resolved
 *            └───────────┘
 *           (can skip acknowledged)
 *
 * Deduplication:
 *   fingerprint = sha256(category + ":" + condition + ":" + source)
 *   Within the cooldown window, repeated raises increment suppressed_count
 *   rather than creating a new record.
 *
 * Escalation:
 *   When suppressed_count exceeds the escalation threshold, the alert's level
 *   is promoted to the next severity tier and a fresh notification is sent.
 *
 * Recovery:
 *   Recovery conditions set is_recovery = true and auto-resolve any open alert
 *   with the matching base condition.
 */
export interface Alert {
  readonly id: string;
  readonly level: AlertLevel;
  readonly category: AlertCategory;
  readonly condition: AlertCondition;
  readonly title: string;
  readonly message: string;
  /** Service or component that raised the alert (e.g. "ExchangeAdapterService"). */
  readonly source: string;
  /**
   * Stable hash used for deduplication and cooldown tracking.
   * sha256(category + ":" + condition + ":" + source), hex-encoded, first 64 chars.
   */
  readonly fingerprint: string;
  readonly status: AlertStatus;
  /** Arbitrary structured context attached at raise time (e.g. latency values). */
  readonly context: Record<string, unknown>;
  /** How many duplicate raises were suppressed during the cooldown window. */
  readonly suppressedCount: number;
  /** How many times the alert has been escalated to a higher level. */
  readonly escalationCount: number;
  /** Channels through which this alert was dispatched. */
  readonly notificationChannels: string[];
  readonly notificationSentAt: Date | null;
  readonly acknowledgedBy: string | null;
  readonly acknowledgedAt: Date | null;
  readonly resolvedAt: Date | null;
  readonly resolutionNote: string | null;
  /** True when this alert represents a system recovery rather than a failure. */
  readonly isRecovery: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Input required to raise a new alert. */
export interface RaiseAlertInput {
  readonly level: AlertLevel;
  readonly category: AlertCategory;
  readonly condition: AlertCondition;
  readonly title: string;
  readonly message: string;
  readonly source: string;
  readonly context?: Record<string, unknown>;
}

/** Result returned after a raise — includes whether it was suppressed or dispatched. */
export interface RaiseAlertResult {
  readonly alert: Alert;
  /** True when the alert was within the cooldown window and suppressed. */
  readonly suppressed: boolean;
  /** True when notifications were dispatched for this raise. */
  readonly notified: boolean;
  /** True when the alert's level was escalated due to repeated suppression. */
  readonly escalated: boolean;
}
