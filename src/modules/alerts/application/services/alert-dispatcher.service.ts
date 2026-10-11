import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { AlertsConfig } from '@config/alerts.config';
import { Alert } from '../../domain/alert.entity';
import { AlertChannel, ALERT_CHANNEL } from '../../infrastructure/channels/alert-channel.interface';

export interface DispatchResult {
  /** Names of channels that successfully delivered the alert. */
  readonly delivered: string[];
  /** Names of channels that failed delivery. */
  readonly failed: string[];
  /** Names of channels skipped (not configured, not in routing for this level). */
  readonly skipped: string[];
}

/**
 * AlertDispatcherService routes an alert to the appropriate channels.
 *
 * Routing rules (from alerts.config):
 *   INFO    → configurable (defaults to no channels)
 *   WARNING → configurable (defaults to no channels)
 *   ERROR   → discord, slack
 *   CRITICAL → discord, slack, telegram, webhook
 *   FATAL   → all configured channels
 *
 * Dispatch is fire-and-forget. Failures are logged at WARN and included in
 * DispatchResult but NEVER thrown — they must never interrupt trading.
 *
 * Channels run concurrently via Promise.allSettled.
 */
@Injectable()
export class AlertDispatcherService {
  private readonly context = AlertDispatcherService.name;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
    @Inject(ALERT_CHANNEL) private readonly channels: AlertChannel[],
  ) {}

  async dispatch(alert: Alert): Promise<DispatchResult> {
    const cfg = this.configService.get<AlertsConfig>('alerts')!;

    if (!cfg.enabled) {
      return { delivered: [], failed: [], skipped: this.channels.map((c) => c.name) };
    }

    const allowedChannelNames = new Set(
      (cfg.routing[alert.level] ?? []).map((n) => n.toLowerCase()),
    );

    const delivered: string[] = [];
    const failed: string[] = [];
    const skipped: string[] = [];

    const tasks = this.channels.map(async (channel) => {
      const name = channel.name.toLowerCase();

      if (!allowedChannelNames.has(name)) {
        skipped.push(name);
        return;
      }

      if (!channel.isConfigured()) {
        this.logger.debug(
          `AlertDispatcher: channel "${name}" not configured — skipping`,
          this.context,
        );
        skipped.push(name);
        return;
      }

      try {
        const ok = await channel.send(alert);
        if (ok) {
          delivered.push(name);
          this.logger.log(
            `AlertDispatcher: dispatched [${alert.level}] "${alert.title}" → ${name}`,
            this.context,
          );
        } else {
          failed.push(name);
        }
      } catch (error) {
        // Defensive: channel.send() should never throw — but guard anyway
        failed.push(name);
        this.logger.warn(
          `AlertDispatcher: unexpected error on channel "${name}" — ${(error as Error).message}`,
          this.context,
        );
      }
    });

    // Run all channels concurrently; never reject
    await Promise.allSettled(tasks);

    if (failed.length > 0) {
      this.logger.warn(
        `AlertDispatcher: ${failed.length} channel(s) failed for alert ${alert.id}: ${failed.join(', ')}`,
        this.context,
      );
    }

    return { delivered, failed, skipped };
  }

  /**
   * Returns all channel names that have valid configuration.
   * Used to populate the `notification_channels` column on an alert.
   */
  configuredChannelNames(): string[] {
    return this.channels.filter((c) => c.isConfigured()).map((c) => c.name);
  }
}
