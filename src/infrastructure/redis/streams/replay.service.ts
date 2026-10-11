import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { RedisClientService } from '../redis-client.service';
import { StreamSerializerService } from './stream-serializer.service';
import { StreamEvent } from './stream-event.interface';
import { StreamName } from './stream-names.constants';

export interface ReplayOptions {
  from?: 'beginning' | 'timestamp' | 'id';
  startTimestamp?: number;
  startId?: string;
  count?: number;
}

export interface ReplayResult {
  events: StreamEvent[];
  lastId: string | null;
  total: number;
}

@Injectable()
export class ReplayService {
  private readonly context = ReplayService.name;

  constructor(
    private readonly redisClient: RedisClientService,
    private readonly serializer: StreamSerializerService,
    private readonly logger: AppLoggerService,
  ) {}

  async replay(streamName: StreamName, options: ReplayOptions = {}): Promise<ReplayResult> {
    const client = this.redisClient.getClient();
    const count = options.count ?? 100;

    let startId: string;
    switch (options.from) {
      case 'beginning':
        startId = '0-0';
        break;
      case 'timestamp':
        if (!options.startTimestamp)
          throw new Error('startTimestamp required for timestamp replay');
        startId = `${options.startTimestamp}-0`;
        break;
      case 'id':
        if (!options.startId) throw new Error('startId required for id replay');
        startId = options.startId;
        break;
      default:
        startId = '0-0';
    }

    this.logger.log(`Replaying ${streamName} from ${startId}, count=${count}`, this.context);

    const raw = (await client.xrange(streamName, startId, '+', 'COUNT', count)) as [
      string,
      string[],
    ][];

    const events: StreamEvent[] = [];
    let lastId: string | null = null;

    for (const [id, rawFields] of raw) {
      try {
        const entry = this.serializer.parseRawEntry(id, rawFields);
        const event = this.serializer.deserialize(entry);
        events.push(event);
        lastId = id;
      } catch (err) {
        this.logger.warn(
          `Skipping unparseable entry ${id} during replay: ${err instanceof Error ? err.message : String(err)}`,
          this.context,
        );
      }
    }

    return { events, lastId, total: events.length };
  }

  async replayLastN(streamName: StreamName, n: number): Promise<ReplayResult> {
    const client = this.redisClient.getClient();
    const raw = (await client.xrevrange(streamName, '+', '-', 'COUNT', n)) as [string, string[]][];

    const events: StreamEvent[] = [];
    let lastId: string | null = null;

    for (const [id, rawFields] of raw.reverse()) {
      try {
        const entry = this.serializer.parseRawEntry(id, rawFields);
        const event = this.serializer.deserialize(entry);
        events.push(event);
        lastId = id;
      } catch {
        // skip
      }
    }

    return { events, lastId, total: events.length };
  }

  async replayPage(streamName: StreamName, afterId: string, count: number): Promise<ReplayResult> {
    return this.replay(streamName, { from: 'id', startId: afterId, count });
  }

  async getFirstId(streamName: StreamName): Promise<string | null> {
    const client = this.redisClient.getClient();
    const raw = (await client.xrange(streamName, '0-0', '+', 'COUNT', 1)) as [string, string[]][];
    return raw.length > 0 ? raw[0][0] : null;
  }

  async getLastId(streamName: StreamName): Promise<string | null> {
    const client = this.redisClient.getClient();
    const raw = (await client.xrevrange(streamName, '+', '-', 'COUNT', 1)) as [string, string[]][];
    return raw.length > 0 ? raw[0][0] : null;
  }
}
