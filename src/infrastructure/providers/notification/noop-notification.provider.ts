import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ok } from '@common/result';
import { healthyResult, ProviderHealth } from '@infrastructure/health/health-check.interface';
import {
  NotificationProvider,
  Notification,
  NotificationResult,
} from './notification-provider.interface';

@Injectable()
export class NoopNotificationProvider implements NotificationProvider {
  async send(notification: Notification): ReturnType<NotificationProvider['send']> {
    return ok({
      notificationId: randomUUID(),
      channel: notification.channel,
      deliveredAt: new Date(),
    } satisfies NotificationResult);
  }

  async sendBatch(notifications: Notification[]): ReturnType<NotificationProvider['sendBatch']> {
    const results: NotificationResult[] = notifications.map((n) => ({
      notificationId: randomUUID(),
      channel: n.channel,
      deliveredAt: new Date(),
    }));
    return ok(results);
  }

  getProviderName(): string {
    return 'noop-notification';
  }

  async getHealth(): Promise<ProviderHealth> {
    return healthyResult('No notification backend configured — noop provider active');
  }
}
