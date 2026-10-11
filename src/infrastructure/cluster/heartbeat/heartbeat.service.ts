import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cpus } from 'os';
import { ClusterConfig } from '@config/cluster.config';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { RedisClientService } from '@infrastructure/redis/redis-client.service';
import { WorkerStatus } from '../identity/worker-identity';
import { WorkerIdService } from '../identity/worker-id.service';
import { WorkerRegistryService } from '../registry/worker-registry.service';

/**
 * HeartbeatService publishes a liveness signal to Redis on a fixed interval
 * and detects dead workers whose heartbeat key has expired.
 *
 * Liveness model:
 *   SET cluster:hb:{nodeId} 1 PX heartbeatTtlMs
 *
 * This key expires automatically if the process dies or loses Redis
 * connectivity for longer than heartbeatTtlMs. The leader's dead-worker
 * check loop periodically scans the worker index and removes any worker
 * whose heartbeat key is missing.
 *
 * CPU measurement:
 * We measure the cumulative user+system CPU time between two heartbeat
 * intervals using process.cpuUsage(prev). Dividing by elapsed wall-clock
 * time and number of logical cores gives a 0–100% per-worker utilization
 * that the load balancer uses to select the least-loaded node.
 *
 * Why polling instead of keyspace notifications?
 * Keyspace notifications require `notify-keyspace-events Kx` in Redis config,
 * which is disabled by default and requires an admin change. Polling every
 * deadWorkerCheckIntervalMs (default 5 s) is negligible overhead and requires
 * zero Redis configuration changes, consistent with the "no external
 * configuration changes needed" design goal.
 */
@Injectable()
export class HeartbeatService implements OnModuleDestroy {
  private readonly context = HeartbeatService.name;

  private static readonly HB_KEY_PREFIX = 'cluster:hb:';

  private heartbeatTimer: NodeJS.Timeout | null = null;
  private deadCheckTimer: NodeJS.Timeout | null = null;

  /** Baseline for CPU delta calculation on each heartbeat. */
  private prevCpuUsage: NodeJS.CpuUsage = process.cpuUsage();
  private prevCpuTime = Date.now();

  /** nodeIds detected as dead on the previous scan (prevents duplicate log spam). */
  private readonly knownDead = new Set<string>();

  private readonly config: ClusterConfig;
  private readonly logicalCpus: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly redis: RedisClientService,
    private readonly workerIdService: WorkerIdService,
    private readonly workerRegistry: WorkerRegistryService,
    private readonly logger: AppLoggerService,
  ) {
    this.config = this.configService.get<ClusterConfig>('cluster')!;
    this.logicalCpus = Math.max(1, cpus().length);
  }

  /**
   * Start publishing heartbeats. Called by ClusterModule.onModuleInit().
   * A missed deadline (e.g. event loop blocked) will let the TTL key expire
   * naturally, causing other nodes to see this worker as dead — correct behaviour.
   */
  start(): void {
    this.heartbeatTimer = setInterval(
      () => void this.publishHeartbeat(),
      this.config.heartbeatIntervalMs,
    );

    // Publish immediately so the worker is visible before the first interval fires.
    void this.publishHeartbeat();

    this.logger.log(
      `Heartbeat started — interval=${this.config.heartbeatIntervalMs}ms, ttl=${this.config.heartbeatTtlMs}ms`,
      this.context,
    );
  }

  /**
   * Start the dead-worker scanner. Should only be called on the leader node
   * (LeaderElectionService calls this after gaining leadership).
   */
  startDeadWorkerScanner(): void {
    if (this.deadCheckTimer) return; // already running
    this.deadCheckTimer = setInterval(
      () => void this.scanDeadWorkers(),
      this.config.deadWorkerCheckIntervalMs,
    );
    this.logger.log(
      `Dead-worker scanner started — interval=${this.config.deadWorkerCheckIntervalMs}ms`,
      this.context,
    );
  }

  /** Stop the dead-worker scanner (called when leadership is lost). */
  stopDeadWorkerScanner(): void {
    if (this.deadCheckTimer) {
      clearInterval(this.deadCheckTimer);
      this.deadCheckTimer = null;
      this.logger.log('Dead-worker scanner stopped', this.context);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.stopDeadWorkerScanner();

    // Mark self as offline and remove heartbeat key on graceful shutdown
    try {
      this.workerIdService.updateStatus(WorkerStatus.OFFLINE);
      const client = this.redis.getClient();
      await client.del(this.heartbeatKey(this.workerIdService.nodeId));
      await this.workerRegistry.deregister(this.workerIdService.nodeId);
    } catch {
      // Best-effort; do not delay shutdown
    }
  }

  private async publishHeartbeat(): Promise<void> {
    try {
      const cpuPercent = this.measureCpuPercent();
      this.workerIdService.refreshMetrics(cpuPercent);

      const info = this.workerIdService.info;
      const client = this.redis.getClient();

      // Refresh the TTL liveness key
      await client.set(this.heartbeatKey(info.nodeId), '1', 'PX', this.config.heartbeatTtlMs);

      // Update mutable fields in the worker hash without rewriting all fields
      await this.workerRegistry.updateFields(info.nodeId, {
        status: info.status,
        lastHeartbeatAt: info.lastHeartbeatAt,
        cpuPercent: String(info.cpuPercent),
        memoryBytes: String(info.memoryBytes),
        activeTaskCount: String(info.activeTaskCount),
      });
    } catch (err) {
      this.logger.error(
        `Heartbeat publish failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
        this.context,
      );
    }
  }

  private async scanDeadWorkers(): Promise<void> {
    try {
      const nodeIds = await this.workerRegistry.getRegisteredNodeIds();
      if (nodeIds.length === 0) return;

      const client = this.redis.getClient();
      const pipeline = client.pipeline();
      for (const id of nodeIds) {
        pipeline.exists(this.heartbeatKey(id));
      }
      const results = await pipeline.exec();

      const currentlyDead = new Set<string>();
      for (let i = 0; i < nodeIds.length; i++) {
        const [err, exists] = (results?.[i] ?? [null, 0]) as [Error | null, number];
        if (!err && exists === 0) {
          currentlyDead.add(nodeIds[i]);
        }
      }

      for (const deadId of currentlyDead) {
        if (!this.knownDead.has(deadId)) {
          this.logger.warn(
            `Dead worker detected (heartbeat expired): nodeId=${deadId} — deregistering`,
            this.context,
          );
          this.knownDead.add(deadId);
        }
        await this.workerRegistry.deregister(deadId);
      }

      // Recover workers that re-appeared (e.g. after a transient Redis outage)
      for (const id of this.knownDead) {
        if (!currentlyDead.has(id)) {
          this.knownDead.delete(id);
        }
      }
    } catch (err) {
      this.logger.error(
        `Dead-worker scan failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
        this.context,
      );
    }
  }

  /**
   * Compute CPU utilization in percent since the last heartbeat.
   *
   * process.cpuUsage() returns cumulative user+system microseconds since the
   * Node.js process started. By taking the delta between two consecutive calls
   * and dividing by the elapsed wall-clock time (in microseconds) and the
   * number of logical CPUs we get a per-process utilization figure.
   */
  private measureCpuPercent(): number {
    const now = Date.now();
    const elapsedMs = now - this.prevCpuTime;
    const elapsedUs = elapsedMs * 1_000;

    const current = process.cpuUsage(this.prevCpuUsage);
    const totalUs = current.user + current.system;

    this.prevCpuUsage = process.cpuUsage();
    this.prevCpuTime = now;

    if (elapsedUs <= 0) return 0;
    return Math.min(100, (totalUs / (elapsedUs * this.logicalCpus)) * 100);
  }

  heartbeatKey(nodeId: string): string {
    return `${HeartbeatService.HB_KEY_PREFIX}${nodeId}`;
  }

  /** Check if a specific node is alive (has an active heartbeat key). */
  async isAlive(nodeId: string): Promise<boolean> {
    const client = this.redis.getClient();
    const exists = await client.exists(this.heartbeatKey(nodeId));
    return exists === 1;
  }
}
