import { Result } from '@common/result';
import { InfrastructureError } from '@common/errors/infrastructure.error';
import { HealthCheckable } from '@infrastructure/health/health-check.interface';

export type NotificationChannel = 'email' | 'sms' | 'push' | 'webhook' | 'slack';

export interface Notification {
  readonly channel: NotificationChannel;
  readonly recipient: string;
  readonly subject?: string;
  readonly body: string;
  readonly metadata?: Record<string, unknown>;
}

export interface NotificationResult {
  readonly notificationId: string;
  readonly channel: NotificationChannel;
  readonly deliveredAt: Date;
}

/**
 * NotificationProvider sends alerts, confirmations, and system messages
 * through configured channels.
 *
 * Used for: trade confirmations, margin call alerts, risk limit breaches,
 * system health alerts, end-of-day summaries.
 *
 * Critically: never send account numbers, passwords, or API keys via
 * notification channels. Send identifiers only; recipients look up details
 * via authenticated sessions.
 */
export interface NotificationProvider extends HealthCheckable {
  send(notification: Notification): Promise<Result<NotificationResult, InfrastructureError>>;
  sendBatch(
    notifications: Notification[],
  ): Promise<Result<NotificationResult[], InfrastructureError>>;
  getProviderName(): string;
}
