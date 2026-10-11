import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { AlertsConfig } from '@config/alerts.config';
import { Alert } from '../../domain/alert.entity';
import { AlertChannel } from './alert-channel.interface';

/**
 * WebhookChannel POSTs a JSON payload to a configurable URL.
 *
 * When a secret is configured the payload is signed:
 *   X-Alert-Signature: sha256=<hmac-hex>
 * Consumers can verify integrity by computing HMAC-SHA256(secret, body).
 */
@Injectable()
export class WebhookChannel implements AlertChannel {
  readonly name = 'webhook';
  private readonly context = WebhookChannel.name;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {}

  isConfigured(): boolean {
    const cfg = this.configService.get<AlertsConfig>('alerts')!.channels.webhook;
    return cfg !== null && cfg.url.startsWith('http');
  }

  async send(alert: Alert): Promise<boolean> {
    const cfg = this.configService.get<AlertsConfig>('alerts')!.channels.webhook;
    if (!cfg) return false;

    const payload = {
      alertId: alert.id,
      level: alert.level,
      category: alert.category,
      condition: alert.condition,
      title: alert.title,
      message: alert.message,
      source: alert.source,
      fingerprint: alert.fingerprint,
      status: alert.status,
      isRecovery: alert.isRecovery,
      suppressedCount: alert.suppressedCount,
      escalationCount: alert.escalationCount,
      context: alert.context,
      createdAt: alert.createdAt.toISOString(),
      updatedAt: alert.updatedAt.toISOString(),
    };

    const body = JSON.stringify(payload);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Alert-Level': alert.level,
      'X-Alert-Category': alert.category,
      ...cfg.headers,
    };

    // HMAC signing if secret is configured
    if (cfg.secret) {
      const sig = createHmac('sha256', cfg.secret).update(body).digest('hex');
      headers['X-Alert-Signature'] = `sha256=${sig}`;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

      const response = await fetch(cfg.url, {
        method: cfg.method,
        headers,
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        this.logger.warn(`Webhook channel: HTTP ${response.status} from ${cfg.url}`, this.context);
        return false;
      }
      return true;
    } catch (error) {
      this.logger.warn(
        `Webhook channel: delivery failed — ${(error as Error).message}`,
        this.context,
      );
      return false;
    }
  }
}
