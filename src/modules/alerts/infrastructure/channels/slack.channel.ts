import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { AlertsConfig } from '@config/alerts.config';
import { AlertLevel } from '../../domain/alert-level.enum';
import { Alert } from '../../domain/alert.entity';
import { AlertChannel } from './alert-channel.interface';

/** Slack attachment colors keyed by alert level. */
const LEVEL_COLORS: Record<AlertLevel, string> = {
  [AlertLevel.INFO]: '#3498db',
  [AlertLevel.WARNING]: '#f39c12',
  [AlertLevel.ERROR]: '#e74c3c',
  [AlertLevel.CRITICAL]: '#8e44ad',
  [AlertLevel.FATAL]: '#1a1a1a',
};

const LEVEL_EMOJI: Record<AlertLevel, string> = {
  [AlertLevel.INFO]: ':information_source:',
  [AlertLevel.WARNING]: ':warning:',
  [AlertLevel.ERROR]: ':red_circle:',
  [AlertLevel.CRITICAL]: ':rotating_light:',
  [AlertLevel.FATAL]: ':skull:',
};

@Injectable()
export class SlackChannel implements AlertChannel {
  readonly name = 'slack';
  private readonly context = SlackChannel.name;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {}

  isConfigured(): boolean {
    const cfg = this.configService.get<AlertsConfig>('alerts')!.channels.slack;
    return cfg !== null && cfg.webhookUrl.startsWith('https://');
  }

  async send(alert: Alert): Promise<boolean> {
    const cfg = this.configService.get<AlertsConfig>('alerts')!.channels.slack;
    if (!cfg) return false;

    const emoji = LEVEL_EMOJI[alert.level];
    const color = LEVEL_COLORS[alert.level];

    const fields = [
      { title: 'Category', value: alert.category, short: true },
      { title: 'Condition', value: alert.condition, short: true },
      { title: 'Source', value: alert.source, short: true },
      { title: 'Status', value: alert.status, short: true },
    ];

    if (alert.isRecovery) {
      fields.push({ title: 'Recovery', value: '✅ System recovered', short: true });
    }
    if (alert.suppressedCount > 0) {
      fields.push({ title: 'Suppressed', value: `${alert.suppressedCount}×`, short: true });
    }
    if (alert.escalationCount > 0) {
      fields.push({ title: 'Escalations', value: String(alert.escalationCount), short: true });
    }

    const payload = {
      channel: cfg.channel,
      username: cfg.username,
      attachments: [
        {
          fallback: `[${alert.level}] ${alert.title}: ${alert.message}`,
          color,
          title: `${emoji} [${alert.level}] ${alert.title}`,
          text: alert.message,
          fields,
          footer: `Alert ID: ${alert.id}`,
          ts: Math.floor(alert.createdAt.getTime() / 1000),
        },
      ],
    };

    return this.postJson(cfg.webhookUrl, payload, cfg.timeoutMs);
  }

  private async postJson(url: string, body: unknown, timeoutMs: number): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        this.logger.warn(
          `Slack channel: HTTP ${response.status} ${response.statusText}`,
          this.context,
        );
        return false;
      }
      return true;
    } catch (error) {
      this.logger.warn(
        `Slack channel: delivery failed — ${(error as Error).message}`,
        this.context,
      );
      return false;
    }
  }
}
