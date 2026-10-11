import { registerAs } from '@nestjs/config';
import { AlertLevel } from '@modules/alerts/domain/alert-level.enum';

// ── Channel configuration interfaces ─────────────────────────────────────────

export interface EmailChannelConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user: string;
  readonly password: string;
  readonly from: string;
  readonly to: string[];
  readonly timeoutMs: number;
}

export interface DiscordChannelConfig {
  readonly webhookUrl: string;
  readonly username: string;
  readonly timeoutMs: number;
}

export interface TelegramChannelConfig {
  readonly botToken: string;
  readonly chatId: string;
  readonly timeoutMs: number;
}

export interface SlackChannelConfig {
  readonly webhookUrl: string;
  readonly channel: string;
  readonly username: string;
  readonly timeoutMs: number;
}

export interface WebhookChannelConfig {
  readonly url: string;
  readonly method: 'POST' | 'PUT';
  readonly headers: Record<string, string>;
  readonly timeoutMs: number;
  readonly secret: string; // HMAC-SHA256 signing key; empty = unsigned
}

export interface AlertsConfig {
  readonly enabled: boolean;
  readonly cooldownSeconds: number;
  /** Number of suppressed repeats before the alert is escalated. */
  readonly escalationThreshold: number;
  /** Rolling window (seconds) in which suppressedCount is tracked for escalation. */
  readonly escalationWindowSeconds: number;
  readonly thresholds: {
    readonly priceDeviationWarnPercent: number;
    readonly latencyWarnMs: number;
    readonly errorRateWarnPercent: number;
    readonly drawdownWarnPercent: number;
    readonly positionUtilizationWarnPercent: number;
    readonly fillRateWarnPercent: number;
    readonly cpuWarnPercent: number;
    readonly memoryWarnPercent: number;
    readonly diskWarnPercent: number;
    readonly queueLagWarnMessages: number;
  };
  /**
   * Per-level routing: maps AlertLevel → list of channel names to notify.
   * Channels not listed receive no alert for that level.
   */
  readonly routing: Record<AlertLevel, string[]>;
  readonly channels: {
    readonly email: EmailChannelConfig | null;
    readonly discord: DiscordChannelConfig | null;
    readonly telegram: TelegramChannelConfig | null;
    readonly slack: SlackChannelConfig | null;
    readonly webhook: WebhookChannelConfig | null;
  };
}

// ── Helper: parse comma-separated routing list ─────────────────────────────

function parseChannelList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// ── Helper: parse recipients list ─────────────────────────────────────────────

function parseEmailRecipients(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── Helper: parse generic Record<string,string> headers ───────────────────────

function parseHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // ignore malformed JSON
  }
  return {};
}

// ── Factory ───────────────────────────────────────────────────────────────────

export const alertsConfig = registerAs('alerts', (): AlertsConfig => {
  const emailEnabled = process.env.ALERT_EMAIL_ENABLED === 'true';
  const discordEnabled = process.env.ALERT_DISCORD_ENABLED === 'true';
  const telegramEnabled = process.env.ALERT_TELEGRAM_ENABLED === 'true';
  const slackEnabled = process.env.ALERT_SLACK_ENABLED === 'true';
  const webhookEnabled = process.env.ALERT_WEBHOOK_ENABLED === 'true';

  return {
    enabled: process.env.ALERTS_ENABLED !== 'false',
    cooldownSeconds: parseInt(process.env.ALERTS_COOLDOWN_SECONDS ?? '300', 10),
    escalationThreshold: parseInt(process.env.ALERTS_ESCALATION_THRESHOLD ?? '3', 10),
    escalationWindowSeconds: parseInt(process.env.ALERTS_ESCALATION_WINDOW_SECONDS ?? '900', 10),

    thresholds: {
      priceDeviationWarnPercent: parseFloat(process.env.ALERTS_PRICE_DEVIATION_WARN_PERCENT ?? '5'),
      latencyWarnMs: parseInt(process.env.ALERTS_LATENCY_WARN_MS ?? '500', 10),
      errorRateWarnPercent: parseFloat(process.env.ALERTS_ERROR_RATE_WARN_PERCENT ?? '10'),
      drawdownWarnPercent: parseFloat(process.env.ALERTS_DRAWDOWN_WARN_PERCENT ?? '5'),
      positionUtilizationWarnPercent: parseFloat(process.env.ALERTS_POSITION_WARN_PERCENT ?? '80'),
      fillRateWarnPercent: parseFloat(process.env.ALERTS_FILL_RATE_WARN_PERCENT ?? '95'),
      cpuWarnPercent: parseFloat(process.env.ALERTS_CPU_WARN_PERCENT ?? '85'),
      memoryWarnPercent: parseFloat(process.env.ALERTS_MEMORY_WARN_PERCENT ?? '85'),
      diskWarnPercent: parseFloat(process.env.ALERTS_DISK_WARN_PERCENT ?? '85'),
      queueLagWarnMessages: parseInt(process.env.ALERTS_QUEUE_LAG_WARN_MESSAGES ?? '1000', 10),
    },

    routing: {
      [AlertLevel.INFO]: parseChannelList(process.env.ALERT_ROUTE_INFO),
      [AlertLevel.WARNING]: parseChannelList(
        process.env.ALERT_ROUTE_WARNING ?? process.env.ALERT_ROUTE_INFO,
      ),
      [AlertLevel.ERROR]: parseChannelList(process.env.ALERT_ROUTE_ERROR ?? 'discord,slack'),
      [AlertLevel.CRITICAL]: parseChannelList(
        process.env.ALERT_ROUTE_CRITICAL ?? 'discord,slack,telegram,webhook',
      ),
      [AlertLevel.FATAL]: parseChannelList(
        process.env.ALERT_ROUTE_FATAL ?? 'discord,slack,telegram,email,webhook',
      ),
    },

    channels: {
      email: emailEnabled
        ? {
            host: process.env.ALERT_EMAIL_HOST ?? 'smtp.gmail.com',
            port: parseInt(process.env.ALERT_EMAIL_PORT ?? '465', 10),
            secure: process.env.ALERT_EMAIL_SECURE !== 'false',
            user: process.env.ALERT_EMAIL_USER ?? '',
            password: process.env.ALERT_EMAIL_PASSWORD ?? '',
            from: process.env.ALERT_EMAIL_FROM ?? 'alerts@trading-platform',
            to: parseEmailRecipients(process.env.ALERT_EMAIL_TO),
            timeoutMs: parseInt(process.env.ALERT_EMAIL_TIMEOUT_MS ?? '10000', 10),
          }
        : null,

      discord: discordEnabled
        ? {
            webhookUrl: process.env.ALERT_DISCORD_WEBHOOK_URL ?? '',
            username: process.env.ALERT_DISCORD_USERNAME ?? 'TradingBot Alerts',
            timeoutMs: parseInt(process.env.ALERT_DISCORD_TIMEOUT_MS ?? '5000', 10),
          }
        : null,

      telegram: telegramEnabled
        ? {
            botToken: process.env.ALERT_TELEGRAM_BOT_TOKEN ?? '',
            chatId: process.env.ALERT_TELEGRAM_CHAT_ID ?? '',
            timeoutMs: parseInt(process.env.ALERT_TELEGRAM_TIMEOUT_MS ?? '5000', 10),
          }
        : null,

      slack: slackEnabled
        ? {
            webhookUrl: process.env.ALERT_SLACK_WEBHOOK_URL ?? '',
            channel: process.env.ALERT_SLACK_CHANNEL ?? '#alerts',
            username: process.env.ALERT_SLACK_USERNAME ?? 'TradingBot Alerts',
            timeoutMs: parseInt(process.env.ALERT_SLACK_TIMEOUT_MS ?? '5000', 10),
          }
        : null,

      webhook: webhookEnabled
        ? {
            url: process.env.ALERT_WEBHOOK_URL ?? '',
            method: (process.env.ALERT_WEBHOOK_METHOD as 'POST' | 'PUT') ?? 'POST',
            headers: parseHeaders(process.env.ALERT_WEBHOOK_HEADERS),
            timeoutMs: parseInt(process.env.ALERT_WEBHOOK_TIMEOUT_MS ?? '5000', 10),
            secret: process.env.ALERT_WEBHOOK_SECRET ?? '',
          }
        : null,
    },
  };
});
