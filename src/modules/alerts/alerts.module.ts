import { Module } from '@nestjs/common';

// Domain
import { AlertEngineService } from './application/services/alert-engine.service';
import { AlertRateLimiterService } from './application/services/alert-rate-limiter.service';
import { AlertEscalationService } from './application/services/alert-escalation.service';
import { AlertDispatcherService } from './application/services/alert-dispatcher.service';
import { AlertStoreService } from './application/services/alert-store.service';

// Infrastructure
import { AlertRepository } from './infrastructure/repository/alert.repository';
import { ALERT_CHANNEL, AlertChannel } from './infrastructure/channels/alert-channel.interface';
import { DiscordChannel } from './infrastructure/channels/discord.channel';
import { TelegramChannel } from './infrastructure/channels/telegram.channel';
import { SlackChannel } from './infrastructure/channels/slack.channel';
import { WebhookChannel } from './infrastructure/channels/webhook.channel';
import { EmailChannel } from './infrastructure/channels/email.channel';

/**
 * AlertsModule wires the entire alerting subsystem.
 *
 * Exported services:
 *  - AlertEngineService — the only public API; all other modules inject this.
 *  - AlertStoreService  — for querying alert history (health checks, dashboards).
 *
 * Channel registration:
 *  Channels are registered under the ALERT_CHANNEL multi-provider token.
 *  To add a new channel: implement AlertChannel, add it to the useValue array.
 *
 * Dependency notes:
 *  - InfrastructureModule is @Global so DatabaseModule and RedisModule are
 *    already available; no extra imports needed here.
 *  - AlertRepository needs PgPoolService + AuditService (both from Infra).
 */
@Module({
  providers: [
    // Repository
    AlertRepository,

    // Application services
    AlertRateLimiterService,
    AlertEscalationService,
    AlertStoreService,
    AlertDispatcherService,
    AlertEngineService,

    // Notification channels registered under a multi-provider token
    {
      provide: ALERT_CHANNEL,
      useFactory: (
        discord: DiscordChannel,
        telegram: TelegramChannel,
        slack: SlackChannel,
        webhook: WebhookChannel,
        email: EmailChannel,
      ): AlertChannel[] => [discord, telegram, slack, webhook, email],
      inject: [DiscordChannel, TelegramChannel, SlackChannel, WebhookChannel, EmailChannel],
    },
    DiscordChannel,
    TelegramChannel,
    SlackChannel,
    WebhookChannel,
    EmailChannel,
  ],
  exports: [AlertEngineService, AlertStoreService],
})
export class AlertsModule {}
