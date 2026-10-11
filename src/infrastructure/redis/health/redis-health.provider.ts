import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HealthCheckable,
  ProviderHealth,
  healthyResult,
  degradedResult,
  unhealthyResult,
} from '@infrastructure/health/health-check.interface';
import { RedisClientService } from '../redis-client.service';
import { RedisConfig } from '../config/redis.config';

@Injectable()
export class RedisHealthProvider implements HealthCheckable {
  constructor(
    private readonly redisClient: RedisClientService,
    private readonly configService: ConfigService,
  ) {}

  async getHealth(): Promise<ProviderHealth> {
    const config = this.configService.get<RedisConfig>('redis')!;

    if (!this.redisClient.isConnected()) {
      return unhealthyResult('Redis not connected');
    }

    try {
      const latencyMs = await this.redisClient.ping();

      // INFO commands can stall indefinitely on Docker Desktop Windows due to
      // Hyper-V bridge networking quirks. Wrap each in a 3 s deadline so the
      // health check always resolves rather than blocking the HTTP response.
      // PING already succeeded above, so a stalled INFO is degraded, not fatal.
      const infoTimeout = <T>(p: Promise<T>, label: string): Promise<T> =>
        Promise.race([
          p,
          new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`${label} timed out after 3000ms`)), 3_000),
          ),
        ]);

      const [memoryInfo, connectedClients, replicationInfo] = await Promise.all([
        infoTimeout(this.redisClient.getMemoryUsage(), 'INFO memory'),
        infoTimeout(this.redisClient.getConnectedClients(), 'INFO clients'),
        infoTimeout(this.redisClient.getReplicationInfo(), 'INFO replication'),
      ]);

      const metadata: Record<string, unknown> = {
        latencyMs,
        connectedClients,
        usedMemory: memoryInfo['used_memory_human'],
        maxMemory: memoryInfo['maxmemory_human'],
        role: replicationInfo['role'],
        connectedSlaves: replicationInfo['connected_slaves'],
      };

      if (latencyMs > config.health.latencyWarnThresholdMs) {
        return degradedResult(
          `Redis latency ${latencyMs}ms exceeds warn threshold ${config.health.latencyWarnThresholdMs}ms`,
          latencyMs,
        );
      }

      return {
        ...healthyResult(`Redis healthy — ${latencyMs}ms`, latencyMs),
        metadata,
      };
    } catch (err) {
      return unhealthyResult(
        `Redis health check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
