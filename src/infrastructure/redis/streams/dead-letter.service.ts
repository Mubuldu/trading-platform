import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { RedisClientService } from '../redis-client.service';
import { StreamEvent, DeadLetterEvent } from './stream-event.interface';
import { STREAM_NAMES } from './stream-names.constants';

@Injectable()
export class DeadLetterService {
  private readonly context = DeadLetterService.name;

  constructor(
    private readonly redisClient: RedisClientService,
    private readonly logger: AppLoggerService,
  ) {}

  async send(
    event: StreamEvent,
    failureReason: string,
    consumerName: string,
    streamName: string,
    originalStreamId: string,
  ): Promise<string> {
    const dlqEntry: DeadLetterEvent = {
      originalEvent: JSON.stringify(event),
      failureReason,
      retryCount: event.metadata.retryCount as number,
      timestamp: Date.now(),
      producer: event.producer,
      consumer: consumerName,
      streamName,
      originalStreamId,
    };

    const client = this.redisClient.getClient();
    const streamId = (await client.xadd(
      STREAM_NAMES.DEAD_LETTER,
      'MAXLEN',
      '~',
      '10000',
      '*',
      'originalEvent',
      dlqEntry.originalEvent,
      'failureReason',
      dlqEntry.failureReason,
      'retryCount',
      String(dlqEntry.retryCount),
      'timestamp',
      String(dlqEntry.timestamp),
      'producer',
      dlqEntry.producer,
      'consumer',
      dlqEntry.consumer,
      'streamName',
      dlqEntry.streamName,
      'originalStreamId',
      dlqEntry.originalStreamId,
    )) as string;

    this.logger.warn(
      `Dead-lettered event ${event.eventId} from ${streamName}@${originalStreamId} — ${failureReason}`,
      this.context,
    );

    return streamId;
  }

  async getRecentEntries(count = 100): Promise<DeadLetterEvent[]> {
    const client = this.redisClient.getClient();
    const raw = (await client.xrevrange(STREAM_NAMES.DEAD_LETTER, '+', '-', 'COUNT', count)) as [
      string,
      string[],
    ][];
    return raw.map(([, fields]) => this.parseFields(fields));
  }

  async getCount(): Promise<number> {
    return this.redisClient.getClient().xlen(STREAM_NAMES.DEAD_LETTER) as Promise<number>;
  }

  private parseFields(rawFields: string[]): DeadLetterEvent {
    const f: Record<string, string> = {};
    for (let i = 0; i < rawFields.length - 1; i += 2) {
      f[rawFields[i]] = rawFields[i + 1];
    }
    return {
      originalEvent: f['originalEvent'] ?? '',
      failureReason: f['failureReason'] ?? '',
      retryCount: parseInt(f['retryCount'] ?? '0', 10),
      timestamp: parseInt(f['timestamp'] ?? '0', 10),
      producer: f['producer'] ?? '',
      consumer: f['consumer'] ?? '',
      streamName: f['streamName'] ?? '',
      originalStreamId: f['originalStreamId'] ?? '',
    };
  }
}
