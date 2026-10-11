import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { RedisClientService } from '../redis-client.service';
import { StreamSerializerService } from './stream-serializer.service';
import { StreamValidatorService } from './stream-validator.service';
import { DeadLetterService } from './dead-letter.service';
import { StreamEvent, ConsumedMessage } from './stream-event.interface';
import { RedisConfig } from '../config/redis.config';
import { StreamName } from './stream-names.constants';

export type MessageHandler = (message: ConsumedMessage) => Promise<void>;

export interface ConsumerSubscription {
  readonly streamName: StreamName;
  readonly groupName: string;
  readonly consumerName: string;
  stop(): void;
}

interface ActiveConsumer {
  streamName: StreamName;
  groupName: string;
  consumerName: string;
  handler: MessageHandler;
  running: boolean;
  loopPromise: Promise<void> | null;
  /** Dedicated ioredis connection for XREADGROUP BLOCK — never shared. */
  blockingClient: Redis;
}

@Injectable()
export class StreamConsumerService implements OnModuleDestroy {
  private readonly context = StreamConsumerService.name;
  private readonly consumers = new Map<string, ActiveConsumer>();

  constructor(
    private readonly redisClient: RedisClientService,
    private readonly serializer: StreamSerializerService,
    private readonly validator: StreamValidatorService,
    private readonly deadLetter: DeadLetterService,
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {}

  subscribe(
    streamName: StreamName,
    groupName: string,
    handler: MessageHandler,
    consumerName?: string,
  ): ConsumerSubscription {
    const name = consumerName ?? `${groupName}-${randomUUID().slice(0, 8)}`;
    const key = `${streamName}:${groupName}:${name}`;

    if (this.consumers.has(key)) {
      throw new Error(`Consumer already registered: ${key}`);
    }

    // Each consumer loop gets its own dedicated connection so multiple concurrent
    // XREADGROUP BLOCK calls don't serialize on the shared primary client.
    const blockingClient = this.redisClient.createBlockingClient();

    const consumer: ActiveConsumer = {
      streamName,
      groupName,
      consumerName: name,
      handler,
      running: true,
      loopPromise: null,
      blockingClient,
    };

    this.consumers.set(key, consumer);
    consumer.loopPromise = this.runLoop(consumer);

    this.logger.log(`Consumer started: ${key}`, this.context);

    return {
      streamName,
      groupName,
      consumerName: name,
      stop: () => this.stopConsumer(key),
    };
  }

  private async runLoop(consumer: ActiveConsumer): Promise<void> {
    const config = this.configService.get<RedisConfig>('redis')!;
    const { blockTimeoutMs, batchSize } = config.consumer;

    while (consumer.running) {
      try {
        await this.readAndProcess(consumer, batchSize, blockTimeoutMs);
      } catch (err) {
        if (!consumer.running) break;
        this.logger.error(
          `Consumer loop error [${consumer.groupName}/${consumer.consumerName}]: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err.stack : undefined,
          this.context,
        );
        await this.sleep(1000);
      }
    }
  }

  private async readAndProcess(
    consumer: ActiveConsumer,
    count: number,
    blockMs: number,
  ): Promise<void> {
    // Use the consumer's own dedicated connection — never the shared primary client.
    // This lets all active consumer loops block concurrently without starving each other.
    const client = consumer.blockingClient;

    const results = (await client.xreadgroup(
      'GROUP',
      consumer.groupName,
      consumer.consumerName,
      'COUNT',
      count,
      'BLOCK',
      blockMs,
      'STREAMS',
      consumer.streamName,
      '>',
    )) as [string, [string, string[]][]][] | null;

    if (!results) return;

    for (const [, entries] of results) {
      for (const [streamId, rawFields] of entries) {
        await this.processEntry(consumer, streamId, rawFields);
      }
    }
  }

  private async processEntry(
    consumer: ActiveConsumer,
    streamId: string,
    rawFields: string[],
  ): Promise<void> {
    const config = this.configService.get<RedisConfig>('redis')!;
    const maxRetries = config.consumer.maxRetries;

    let event: StreamEvent;
    try {
      const entry = this.serializer.parseRawEntry(streamId, rawFields);
      const partial = this.validator.validatePartial(entry.fields);
      if (!partial.valid) {
        this.logger.warn(
          `Rejecting malformed message ${streamId}: ${partial.errors.join(', ')}`,
          this.context,
        );
        await this.ack(consumer.streamName, consumer.groupName, streamId);
        return;
      }
      event = this.serializer.deserialize(entry);
    } catch (err) {
      this.logger.error(
        `Failed to deserialize message ${streamId}: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        this.context,
      );
      await this.ack(consumer.streamName, consumer.groupName, streamId);
      return;
    }

    const retryCount = (event.metadata.retryCount as number) ?? 0;

    if (retryCount >= maxRetries) {
      await this.deadLetter.send(
        event,
        `Max retries (${maxRetries}) exceeded`,
        consumer.consumerName,
        consumer.streamName,
        streamId,
      );
      await this.ack(consumer.streamName, consumer.groupName, streamId);
      return;
    }

    const message: ConsumedMessage = {
      streamId,
      event,
      streamName: consumer.streamName,
      consumerGroup: consumer.groupName,
      consumerName: consumer.consumerName,
    };

    try {
      await consumer.handler(message);
      // Only ACK after successful processing
      await this.ack(consumer.streamName, consumer.groupName, streamId);
    } catch (err) {
      this.logger.warn(
        `Handler failed for ${streamId} (retry ${retryCount + 1}/${maxRetries}): ${err instanceof Error ? err.message : String(err)}`,
        this.context,
      );
      // Leave message pending — will be reclaimed by pending recovery
    }
  }

  private async ack(streamName: string, groupName: string, streamId: string): Promise<void> {
    try {
      await this.redisClient.getClient().xack(streamName, groupName, streamId);
    } catch (err) {
      this.logger.error(
        `XACK failed for ${streamId}: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        this.context,
      );
    }
  }

  private stopConsumer(key: string): void {
    const consumer = this.consumers.get(key);
    if (consumer) {
      consumer.running = false;
      this.consumers.delete(key);
      // Quit the dedicated blocking connection — no longer needed.
      void consumer.blockingClient.quit().catch(() => {
        /* best-effort; ignore errors during shutdown */
      });
      this.logger.log(`Consumer stopped: ${key}`, this.context);
    }
  }

  async onModuleDestroy(): Promise<void> {
    const keys = [...this.consumers.keys()];
    for (const key of keys) {
      this.stopConsumer(key);
    }
    // Allow running loops to finish their current iteration
    await this.sleep(500);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getActiveConsumerCount(): number {
    return this.consumers.size;
  }

  getActiveConsumers(): { streamName: string; groupName: string; consumerName: string }[] {
    return [...this.consumers.values()].map((c) => ({
      streamName: c.streamName,
      groupName: c.groupName,
      consumerName: c.consumerName,
    }));
  }
}
