import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { RedisClientService } from '../redis-client.service';
import { StreamSerializerService } from './stream-serializer.service';
import { StreamValidatorService } from './stream-validator.service';
import { StreamEvent, STREAM_SCHEMA_VERSION } from './stream-event.interface';
import { RedisConfig } from '../config/redis.config';
import { StreamName } from './stream-names.constants';

export type PublishEventInput = Omit<StreamEvent, 'eventId' | 'schemaVersion' | 'metadata'> & {
  metadata?: Record<string, unknown>;
};

@Injectable()
export class StreamPublisherService {
  private readonly context = StreamPublisherService.name;

  constructor(
    private readonly redisClient: RedisClientService,
    private readonly serializer: StreamSerializerService,
    private readonly validator: StreamValidatorService,
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {}

  async publish(streamName: StreamName, input: PublishEventInput): Promise<string> {
    const event: StreamEvent = {
      ...input,
      eventId: randomUUID(),
      schemaVersion: STREAM_SCHEMA_VERSION,
      metadata: {
        retryCount: 0,
        ...(input.metadata ?? {}),
      },
    };

    const validation = this.validator.validate(event);
    if (!validation.valid) {
      throw new Error(`Invalid stream event: ${validation.errors.join(', ')}`);
    }

    const fields = this.serializer.serialize(event);
    const config = this.configService.get<RedisConfig>('redis')!;
    const maxLen = String(config.streams.maxLen);

    const client = this.redisClient.getClient();
    const flatFields: string[] = [];
    for (const [k, v] of Object.entries(fields)) {
      flatFields.push(k, v);
    }

    let streamId: string;
    if (config.streams.approximateMaxLen) {
      streamId = (await client.xadd(
        streamName,
        'MAXLEN',
        '~',
        maxLen,
        '*',
        ...flatFields,
      )) as string;
    } else {
      streamId = (await client.xadd(streamName, 'MAXLEN', maxLen, '*', ...flatFields)) as string;
    }

    this.logger.debug(
      `Published ${event.eventType} [${event.eventId}] → ${streamName}@${streamId}`,
      this.context,
    );

    return streamId;
  }

  async publishBatch(streamName: StreamName, inputs: PublishEventInput[]): Promise<string[]> {
    const ids: string[] = [];
    for (const input of inputs) {
      ids.push(await this.publish(streamName, input));
    }
    return ids;
  }

  async getStreamLength(streamName: StreamName): Promise<number> {
    return this.redisClient.getClient().xlen(streamName) as Promise<number>;
  }
}
