import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { RedisClientService } from '../redis-client.service';
import { StreamSerializerService } from './stream-serializer.service';
import { DeadLetterService } from './dead-letter.service';
import { ConsumerInfo, GroupInfo, PendingMessage } from './stream-event.interface';
import { RedisConfig } from '../config/redis.config';
import { StreamName } from './stream-names.constants';

export interface ConsumerGroupRegistration {
  streamName: StreamName;
  groupName: string;
  startId?: string;
}

@Injectable()
export class ConsumerManagerService implements OnModuleInit, OnModuleDestroy {
  private readonly context = ConsumerManagerService.name;
  private readonly registrations: ConsumerGroupRegistration[] = [];
  private pendingRecoveryTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly redisClient: RedisClientService,
    private readonly serializer: StreamSerializerService,
    private readonly deadLetter: DeadLetterService,
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureAllGroups();
    this.startPendingRecovery();
  }

  onModuleDestroy(): void {
    if (this.pendingRecoveryTimer) {
      clearInterval(this.pendingRecoveryTimer);
      this.pendingRecoveryTimer = null;
    }
  }

  async registerGroup(reg: ConsumerGroupRegistration): Promise<void> {
    this.registrations.push(reg);
    await this.createGroupIfMissing(reg);
  }

  private async ensureAllGroups(): Promise<void> {
    for (const reg of this.registrations) {
      await this.createGroupIfMissing(reg);
    }
  }

  private async createGroupIfMissing(reg: ConsumerGroupRegistration): Promise<void> {
    const client = this.redisClient.getClient();
    try {
      await client.xgroup('CREATE', reg.streamName, reg.groupName, reg.startId ?? '$', 'MKSTREAM');
      this.logger.log(
        `Consumer group created: ${reg.groupName} on ${reg.streamName}`,
        this.context,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('BUSYGROUP')) {
        this.logger.debug(
          `Consumer group already exists: ${reg.groupName} on ${reg.streamName}`,
          this.context,
        );
      } else {
        this.logger.error(
          `Failed to create group ${reg.groupName} on ${reg.streamName}: ${msg}`,
          undefined,
          this.context,
        );
        throw err;
      }
    }
  }

  private startPendingRecovery(): void {
    const config = this.configService.get<RedisConfig>('redis')!;
    const interval = config.consumer.pendingRecoveryIntervalMs;

    this.pendingRecoveryTimer = setInterval(() => {
      void this.recoverPendingMessages().catch((err) => {
        this.logger.error(
          `Pending recovery failed: ${err instanceof Error ? err.message : String(err)}`,
          undefined,
          this.context,
        );
      });
    }, interval);
  }

  async recoverPendingMessages(): Promise<void> {
    const config = this.configService.get<RedisConfig>('redis')!;
    const idleThresholdMs = config.consumer.processingTimeoutMs;
    const maxRetries = config.consumer.maxRetries;
    const client = this.redisClient.getClient();

    for (const reg of this.registrations) {
      try {
        const pending = await this.getPendingMessages(reg.streamName, reg.groupName, 100);

        for (const msg of pending) {
          if (msg.idleMs < idleThresholdMs) continue;

          this.logger.warn(
            `Reclaiming idle message ${msg.streamId} (idle ${msg.idleMs}ms, retry ${msg.retryCount})`,
            this.context,
          );

          if (msg.retryCount >= maxRetries) {
            await this.claimAndDeadLetter(
              client,
              reg.streamName,
              reg.groupName,
              msg,
              maxRetries,
              config,
            );
          } else {
            await this.claimForRetry(client, reg.streamName, reg.groupName, msg, config);
          }
        }

        await this.detectIdleConsumers(reg.streamName, reg.groupName, config);
      } catch (err) {
        this.logger.error(
          `Recovery error on ${reg.streamName}/${reg.groupName}: ${err instanceof Error ? err.message : String(err)}`,
          undefined,
          this.context,
        );
      }
    }
  }

  private async claimAndDeadLetter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: any,
    streamName: StreamName,
    groupName: string,
    msg: PendingMessage,
    maxRetries: number,
    config: RedisConfig,
  ): Promise<void> {
    const recoveryConsumer = `recovery-${process.pid}`;
    const claimed = (await client.xclaim(
      streamName,
      groupName,
      recoveryConsumer,
      config.consumer.processingTimeoutMs,
      msg.streamId,
      'JUSTID',
    )) as string[];

    if (claimed.length === 0) return;

    const rawEntry = (await client.xrange(streamName, msg.streamId, msg.streamId)) as [
      string,
      string[],
    ][];
    if (rawEntry.length > 0) {
      const [, rawFields] = rawEntry[0];
      const entry = this.serializer.parseRawEntry(msg.streamId, rawFields);
      const event = this.serializer.deserialize(entry);

      await this.deadLetter.send(
        event,
        `Max retries (${maxRetries}) exceeded during recovery`,
        msg.consumerName,
        streamName,
        msg.streamId,
      );
    }

    await client.xack(streamName, groupName, msg.streamId);
  }

  private async claimForRetry(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: any,
    streamName: StreamName,
    groupName: string,
    msg: PendingMessage,
    config: RedisConfig,
  ): Promise<void> {
    const recoveryConsumer = `recovery-${process.pid}`;
    await client.xclaim(
      streamName,
      groupName,
      recoveryConsumer,
      config.consumer.processingTimeoutMs,
      msg.streamId,
    );
  }

  async getPendingMessages(
    streamName: StreamName,
    groupName: string,
    count = 50,
  ): Promise<PendingMessage[]> {
    const client = this.redisClient.getClient();
    const raw = (await client.xpending(streamName, groupName, '-', '+', count)) as [
      string,
      string,
      number,
      number,
    ][];

    return raw.map(([id, consumer, idleMs, retryCount]) => ({
      streamId: id,
      consumerName: consumer,
      idleMs,
      retryCount,
    }));
  }

  async getGroupInfo(streamName: StreamName): Promise<GroupInfo[]> {
    const client = this.redisClient.getClient();
    const raw = (await client.xinfo('GROUPS', streamName)) as (string | number | null)[][];
    return raw.map((group) => {
      const f = this.parseInfoArray(group);
      return {
        name: (f['name'] as string) ?? '',
        consumers: (f['consumers'] as number) ?? 0,
        pending: (f['pending'] as number) ?? 0,
        lastDeliveredId: (f['last-delivered-id'] as string) ?? '0-0',
        entriesRead: f['entries-read'] as number | null,
        lag: f['lag'] as number | null,
      };
    });
  }

  async getConsumerInfo(streamName: StreamName, groupName: string): Promise<ConsumerInfo[]> {
    const client = this.redisClient.getClient();
    const raw = (await client.xinfo('CONSUMERS', streamName, groupName)) as (string | number)[][];
    return raw.map((consumer) => {
      const f = this.parseInfoArray(consumer);
      return {
        name: (f['name'] as string) ?? '',
        pending: (f['pending'] as number) ?? 0,
        idleMs: (f['idle'] as number) ?? 0,
        inactive: (f['inactive'] as number) ?? 0,
      };
    });
  }

  private async detectIdleConsumers(
    streamName: StreamName,
    groupName: string,
    config: RedisConfig,
  ): Promise<void> {
    try {
      const client = this.redisClient.getClient();
      const consumers = await this.getConsumerInfo(streamName, groupName);
      for (const consumer of consumers) {
        if (consumer.idleMs > config.consumer.idleConsumerTimeoutMs && consumer.pending === 0) {
          this.logger.warn(
            `Idle consumer detected: ${consumer.name} on ${streamName}/${groupName} (idle ${consumer.idleMs}ms) — deleting ghost consumer`,
            this.context,
          );
          // Delete the ghost consumer so it stops being iterated on every recovery
          // cycle. Accumulation happens because watch mode restarts create new
          // indicator-engine-XXXXXXXX consumers on every restart but nothing ever
          // cleans them up. With 70+ ghost consumers per stream, the 60-second
          // recovery cycle floods the shared Redis connection with XPENDING /
          // XCLAIM / XINFO commands, starving legitimate XREADGROUP BLOCK calls.
          await client.xgroup('DELCONSUMER', streamName, groupName, consumer.name);
          this.logger.log(
            `Deleted ghost consumer: ${consumer.name} on ${streamName}/${groupName}`,
            this.context,
          );
        }
      }
    } catch {
      // Non-critical — group may not exist yet
    }
  }

  private parseInfoArray(arr: (string | number | null)[]): Record<string, string | number | null> {
    const result: Record<string, string | number | null> = {};
    for (let i = 0; i < arr.length - 1; i += 2) {
      const key = arr[i];
      const value = arr[i + 1];
      if (typeof key === 'string') {
        result[key] = value as string | number | null;
      }
    }
    return result;
  }

  getRegistrations(): ConsumerGroupRegistration[] {
    return [...this.registrations];
  }
}
