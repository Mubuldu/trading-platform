import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { AlertsConfig } from '@config/alerts.config';
import { AlertLevel } from '../../domain/alert-level.enum';
import { Alert } from '../../domain/alert.entity';
import { AlertChannel } from './alert-channel.interface';

const LEVEL_EMOJI: Record<AlertLevel, string> = {
  [AlertLevel.INFO]: 'ℹ️',
  [AlertLevel.WARNING]: '⚠️',
  [AlertLevel.ERROR]: '🔴',
  [AlertLevel.CRITICAL]: '🚨',
  [AlertLevel.FATAL]: '💀',
};

@Injectable()
export class TelegramChannel implements AlertChannel {
  readonly name = 'telegram';
  private readonly context = TelegramChannel.name;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {}

  isConfigured(): boolean {
    const cfg = this.configService.get<AlertsConfig>('alerts')!.channels.telegram;
    return cfg !== null && cfg.botToken !== '' && cfg.chatId !== '';
  }

  async send(alert: Alert): Promise<boolean> {
    const cfg = this.configService.get<AlertsConfig>('alerts')!.channels.telegram;
    if (!cfg) return false;

    const emoji = LEVEL_EMOJI[alert.level];
    const recovery = alert.isRecovery ? '✅ *RECOVERED*\n' : '';

    // Telegram uses MarkdownV2 — escape special chars
    const text = this.escape(
      `${emoji} *[${alert.level}]* ${alert.title}\n` +
        recovery +
        `\n${alert.message}\n` +
        `\n📁 *Category:* ${alert.category}` +
        `\n🔍 *Condition:* ${alert.condition}` +
        `\n🖥️ *Source:* ${alert.source}` +
        (alert.suppressedCount > 0 ? `\n🔇 *Suppressed:* ${alert.suppressedCount}×` : '') +
        (alert.escalationCount > 0 ? `\n📈 *Escalations:* ${alert.escalationCount}` : '') +
        `\n\n🆔 \`${alert.id}\``,
    );

    const url = `https://api.telegram.org/bot${cfg.botToken}/sendMessage`;
    const payload = {
      chat_id: cfg.chatId,
      text,
      parse_mode: 'MarkdownV2',
      disable_web_page_preview: true,
    };

    return this.postJson(url, payload, cfg.timeoutMs);
  }

  /** Escape MarkdownV2 special characters. */
  private escape(text: string): string {
    // Characters that must be escaped in MarkdownV2 outside code spans
    return text.replace(/([_[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
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
        const errBody = await response.text().catch(() => '');
        this.logger.warn(`Telegram channel: HTTP ${response.status} — ${errBody}`, this.context);
        return false;
      }
      return true;
    } catch (error) {
      this.logger.warn(
        `Telegram channel: delivery failed — ${(error as Error).message}`,
        this.context,
      );
      return false;
    }
  }
}
