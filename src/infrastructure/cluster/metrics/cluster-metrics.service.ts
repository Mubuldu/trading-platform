import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClusterConfig } from '@config/cluster.config';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { RedisClientService } from '@infrastructure/redis/redis-client.service';
import { WorkerIdService } from '../identity/worker-id.service';
import { WorkerDiscoveryService } from '../discovery/worker-discovery.service';
import { WorkerInfo } from '../identity/worker-identity';

/**
 * ClusterMetricsService publishes per-worker resource metrics to Redis and
 * provides a cluster-wide aggregated view.
 *
 * Redis layout (per worker):
 *   cluster:metrics:{nodeId}  — JSON string with full WorkerMetrics, TTL = metricsTtlMs
 *
 * Metrics are published on each heartbeat cycle (separate timer aligned to
 * metricsPublishIntervalMs). Consumers (dashboards, alerting) read the per-node
 * keys directly; ClusterMetricsService.getClusterMetrics() aggregates them.
 *
 * Why store metrics separately from the worker registry hash?
 * The registry hash is authoritative for worker identity and capabilities.
 * Metrics change every few seconds and are best-effort (a missing metrics key
 * does not mean the worker is dead — the heartbeat key is the liveness signal).
 * Keeping them separate avoids polluting the identity store with volatile data.
 */

export interface WorkerMetrics {
  readonly nodeId: string;
  readonly nodeLabel: string;
  readonly cpuPercent: number;
  readonly memoryBytes: number;
  readonly memoryMb: number;
  readonly activeTaskCount: number;
  readonly status: string;
  readonly recordedAt: string;
}

export interface ClusterMetricsSummary {
  readonly workers: WorkerMetrics[];
  readonly totalWorkers: number;
  readonly avgCpuPercent: number;
  readonly totalMemoryBytes: number;
  readonly totalActiveTasks: number;
  readonly recordedAt: string;
}

@Injectable()
export class ClusterMetricsService implements OnModuleDestroy {
  private readonly context = ClusterMetricsService.name;

  private static readonly METRICS_KEY_PREFIX = 'cluster:metrics:';

  private metricsTimer: NodeJS.Timeout | null = null;
  private readonly config: ClusterConfig;

  constructor(
    private readonly configService: ConfigService,
    private readonly redis: RedisClientService,
    private readonly workerIdService: WorkerIdService,
    private readonly discovery: WorkerDiscoveryService,
    private readonly logger: AppLoggerService,
  ) {
    this.config = this.configService.get<ClusterConfig>('cluster')!;
  }

  /** Start periodic metrics publishing. Called by ClusterModule.onModuleInit(). */
  start(): void {
    this.metricsTimer = setInterval(
      () => void this.publishLocalMetrics(),
      this.config.metricsPublishIntervalMs,
    );
    void this.publishLocalMetrics();
    this.logger.debug(
      `Cluster metrics publisher started — interval=${this.config.metricsPublishIntervalMs}ms`,
      this.context,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
    // Best-effort removal of this node's metrics key on shutdown
    try {
      const client = this.redis.getClient();
      await client.del(this.metricsKey(this.workerIdService.nodeId));
    } catch {
      // ignore
    }
  }

  /**
   * Publish local worker metrics to Redis. Redis clients (dashboards,
   * ClusterHealthService) can read these without calling back into this process.
   */
  async publishLocalMetrics(): Promise<void> {
    try {
      const info = this.workerIdService.info;
      const metrics: WorkerMetrics = {
        nodeId: info.nodeId,
        nodeLabel: info.nodeLabel,
        cpuPercent: info.cpuPercent,
        memoryBytes: info.memoryBytes,
        memoryMb: Math.round(info.memoryBytes / (1024 * 1024)),
        activeTaskCount: info.activeTaskCount,
        status: info.status,
        recordedAt: new Date().toISOString(),
      };

      const client = this.redis.getClient();
      await client.set(
        this.metricsKey(info.nodeId),
        JSON.stringify(metrics),
        'PX',
        this.config.metricsTtlMs,
      );
    } catch (err) {
      this.logger.error(
        `Failed to publish local metrics: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
        this.context,
      );
    }
  }

  /**
   * Aggregate metrics from all active workers into a cluster summary.
   * This is a Redis pipeline read — O(N) round-trips reduced to 1.
   */
  async getClusterMetrics(): Promise<ClusterMetricsSummary> {
    const workers = await this.discovery.getActiveWorkers();
    if (workers.length === 0) {
      return {
        workers: [],
        totalWorkers: 0,
        avgCpuPercent: 0,
        totalMemoryBytes: 0,
        totalActiveTasks: 0,
        recordedAt: new Date().toISOString(),
      };
    }

    const client = this.redis.getClient();
    const pipeline = client.pipeline();
    for (const w of workers) {
      pipeline.get(this.metricsKey(w.nodeId));
    }
    const results = await pipeline.exec();

    const workerMetrics: WorkerMetrics[] = [];
    for (let i = 0; i < workers.length; i++) {
      const [err, raw] = (results?.[i] ?? [null, null]) as [Error | null, string | null];
      if (!err && raw) {
        try {
          workerMetrics.push(JSON.parse(raw) as WorkerMetrics);
        } catch {
          // Stale or corrupt entry — skip
        }
      } else {
        // Metrics key expired but heartbeat is still alive — synthesize from registry
        workerMetrics.push(this.synthesizeMetrics(workers[i]));
      }
    }

    const totalWorkers = workerMetrics.length;
    const avgCpuPercent =
      totalWorkers > 0 ? workerMetrics.reduce((s, m) => s + m.cpuPercent, 0) / totalWorkers : 0;
    const totalMemoryBytes = workerMetrics.reduce((s, m) => s + m.memoryBytes, 0);
    const totalActiveTasks = workerMetrics.reduce((s, m) => s + m.activeTaskCount, 0);

    return {
      workers: workerMetrics,
      totalWorkers,
      avgCpuPercent: Math.round(avgCpuPercent * 10) / 10,
      totalMemoryBytes,
      totalActiveTasks,
      recordedAt: new Date().toISOString(),
    };
  }

  private synthesizeMetrics(worker: WorkerInfo): WorkerMetrics {
    return {
      nodeId: worker.nodeId,
      nodeLabel: worker.nodeLabel,
      cpuPercent: worker.cpuPercent,
      memoryBytes: worker.memoryBytes,
      memoryMb: Math.round(worker.memoryBytes / (1024 * 1024)),
      activeTaskCount: worker.activeTaskCount,
      status: worker.status,
      recordedAt: worker.lastHeartbeatAt,
    };
  }

  private metricsKey(nodeId: string): string {
    return `${ClusterMetricsService.METRICS_KEY_PREFIX}${nodeId}`;
  }
}
