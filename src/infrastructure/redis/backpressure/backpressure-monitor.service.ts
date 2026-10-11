import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { RedisClientService } from '../redis-client.service';
import { ConsumerManagerService } from '../streams/consumer-manager.service';
import { GroupInfo } from '../streams/stream-event.interface';
import { StreamName } from '../streams/stream-names.constants';

export interface StreamHealthMetrics {
  streamName: StreamName;
  length: number;
  groups: {
    name: string;
    pending: number;
    lag: number | null;
    consumers: number;
  }[];
}

export interface BackpressureStatus {
  healthy: boolean;
  streams: StreamHealthMetrics[];
  warnings: string[];
  checkedAt: Date;
}

const MAX_PENDING_THRESHOLD = 1_000;
const MAX_LAG_THRESHOLD = 10_000;
const SLOW_CONSUMER_PENDING_THRESHOLD = 500;

@Injectable()
export class BackpressureMonitorService {
  private readonly context = BackpressureMonitorService.name;

  constructor(
    private readonly redisClient: RedisClientService,
    private readonly consumerManager: ConsumerManagerService,
    private readonly logger: AppLoggerService,
  ) {}

  async getStatus(streams: StreamName[]): Promise<BackpressureStatus> {
    const warnings: string[] = [];
    const streamMetrics: StreamHealthMetrics[] = [];

    for (const streamName of streams) {
      try {
        const metrics = await this.collectStreamMetrics(streamName, warnings);
        streamMetrics.push(metrics);
      } catch (err) {
        this.logger.warn(
          `Failed to collect metrics for ${streamName}: ${err instanceof Error ? err.message : String(err)}`,
          this.context,
        );
      }
    }

    const healthy = warnings.length === 0;
    if (!healthy) {
      this.logger.warn(`Backpressure warnings: ${warnings.join('; ')}`, this.context);
    }

    return { healthy, streams: streamMetrics, warnings, checkedAt: new Date() };
  }

  private async collectStreamMetrics(
    streamName: StreamName,
    warnings: string[],
  ): Promise<StreamHealthMetrics> {
    const client = this.redisClient.getClient();

    const length = (await client.xlen(streamName)) as number;
    const groupInfos: GroupInfo[] = await this.consumerManager
      .getGroupInfo(streamName)
      .catch(() => []);

    if (length > MAX_LAG_THRESHOLD) {
      warnings.push(`Stream ${streamName} has ${length} entries (threshold: ${MAX_LAG_THRESHOLD})`);
    }

    const groups = groupInfos.map((g) => {
      if (g.pending > MAX_PENDING_THRESHOLD) {
        warnings.push(
          `Group ${g.name} on ${streamName} has ${g.pending} pending (threshold: ${MAX_PENDING_THRESHOLD})`,
        );
      }
      if (g.lag !== null && g.lag > MAX_LAG_THRESHOLD) {
        warnings.push(
          `Group ${g.name} on ${streamName} has lag ${g.lag} (threshold: ${MAX_LAG_THRESHOLD})`,
        );
      }
      return { name: g.name, pending: g.pending, lag: g.lag, consumers: g.consumers };
    });

    return { streamName, length, groups };
  }

  async detectSlowConsumers(streamName: StreamName, groupName: string): Promise<string[]> {
    const pending = await this.consumerManager.getPendingMessages(streamName, groupName, 1000);
    const consumerPendingCount = new Map<string, number>();

    for (const msg of pending) {
      const count = consumerPendingCount.get(msg.consumerName) ?? 0;
      consumerPendingCount.set(msg.consumerName, count + 1);
    }

    const slow: string[] = [];
    for (const [consumer, count] of consumerPendingCount.entries()) {
      if (count > SLOW_CONSUMER_PENDING_THRESHOLD) {
        slow.push(consumer);
        this.logger.warn(
          `Slow consumer detected: ${consumer} on ${streamName}/${groupName} — ${count} pending`,
          this.context,
        );
      }
    }

    return slow;
  }

  async getConsumerLag(streamName: StreamName, groupName: string): Promise<number> {
    const groups: GroupInfo[] = await this.consumerManager.getGroupInfo(streamName).catch(() => []);
    const group = groups.find((g) => g.name === groupName);
    return group?.lag ?? 0;
  }
}
