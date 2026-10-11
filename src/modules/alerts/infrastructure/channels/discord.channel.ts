import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { AlertsConfig } from '@config/alerts.config';
import { AlertLevel } from '../../domain/alert-level.enum';
import { Alert } from '../../domain/alert.entity';
import { AlertChannel } from './alert-channel.interface';

/** Discord embed colors keyed by alert level. */
const LEVEL_COLORS: Record<AlertLevel, number> = {
  [AlertLevel.INFO]: 0x3498db, // blue
  [AlertLevel.WARNING]: 0xf39c12, // orange
  [AlertLevel.ERROR]: 0xe74c3c, // red
  [AlertLevel.CRITICAL]: 0x8e44ad, // purple
  [AlertLevel.FATAL]: 0x000000, // black
};

/** Level emoji prefix for readability. */
const LEVEL_EMOJI: Record<AlertLevel, string> = {
  [AlertLevel.INFO]: 'ℹ️',
  [AlertLevel.WARNING]: '⚠️',
  [AlertLevel.ERROR]: '🔴',
  [AlertLevel.CRITICAL]: '🚨',
  [AlertLevel.FATAL]: '💀',
};

@Injectable()
export class DiscordChannel implements AlertChannel {
  readonly name = 'discord';
  private readonly context = DiscordChannel.name;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {}

  isConfigured(): boolean {
    const cfg = this.configService.get<AlertsConfig>('alerts')!.channels.discord;
    return cfg !== null && cfg.webhookUrl.startsWith('https://');
  }

  async send(alert: Alert): Promise<boolean> {
    const cfg = this.configService.get<AlertsConfig>('alerts')!.channels.discord;
    if (!cfg) return false;

    const emoji = LEVEL_EMOJI[alert.level];
    const color = LEVEL_COLORS[alert.level];

    const payload = {
      username: cfg.username,
      embeds: [
        {
          title: `${emoji} [${alert.level}] ${alert.title}`,
          description: alert.message,
          color,
          fields: [
            { name: 'Category', value: alert.category, inline: true },
            { name: 'Condition', value: alert.condition, inline: true },
            { name: 'Source', value: alert.source, inline: true },
            { name: 'Status', value: alert.status, inline: true },
            ...(alert.isRecovery
              ? [{ name: '✅ Recovery', value: 'System recovered', inline: true }]
              : []),
            ...(alert.suppressedCount > 0
              ? [{ name: 'Suppressed', value: String(alert.suppressedCount), inline: true }]
              : []),
            ...(alert.escalationCount > 0
              ? [{ name: 'Escalations', value: String(alert.escalationCount), inline: true }]
              : []),
          ],
          footer: { text: `Alert ID: ${alert.id}` },
          timestamp: alert.createdAt.toISOString(),
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
          `Discord channel: HTTP ${response.status} ${response.statusText}`,
          this.context,
        );
        return false;
      }
      return true;
    } catch (error) {
      this.logger.warn(
        `Discord channel: delivery failed — ${(error as Error).message}`,
        this.context,
      );
      return false;
    }
  }
}
