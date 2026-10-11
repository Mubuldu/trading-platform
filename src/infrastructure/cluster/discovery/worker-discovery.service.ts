import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { WorkerInfo, WorkerCapability, WorkerStatus } from '../identity/worker-identity';
import { WorkerRegistryService } from '../registry/worker-registry.service';
import { HeartbeatService } from '../heartbeat/heartbeat.service';

/**
 * WorkerDiscoveryService provides a high-level query interface over the
 * registry and heartbeat systems.
 *
 * It separates "who is registered?" (registry) from "who is alive?"
 * (heartbeat) so that callers can choose the appropriate guarantee:
 *
 *  - getActiveWorkers()      — registered AND heartbeat alive
 *  - getWorkersByCapability() — active workers with a specific capability
 *  - getWorkerCount()        — total active workers (for metrics/scaling decisions)
 *
 * Design note:
 * The discovery service does NOT cache results. Caching would introduce a
 * staleness window that could cause the task router to send work to a dead
 * worker. The round-trip cost to Redis is O(N) pipeline commands where N is
 * the number of registered workers — at 100 workers this is ~100 EXISTS
 * commands batched into one pipeline, which is negligible (< 1 ms on a local
 * Redis, < 3 ms on a typical cloud Redis). The task router calls
 * getActiveWorkers() at most once per task dispatch, so this is acceptable.
 */
@Injectable()
export class WorkerDiscoveryService {
  private readonly context = WorkerDiscoveryService.name;

  constructor(
    private readonly registry: WorkerRegistryService,
    private readonly heartbeat: HeartbeatService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * Return all workers that are both registered and have an active heartbeat.
   * This is the primary query used by load balancers.
   */
  async getActiveWorkers(): Promise<WorkerInfo[]> {
    const all = await this.registry.getAllWorkers();
    if (all.length === 0) return [];

    // Batch-check heartbeats in parallel
    const aliveFlags = await Promise.all(all.map((w) => this.heartbeat.isAlive(w.nodeId)));

    return all.filter((_, i) => aliveFlags[i]);
  }

  /**
   * Return active workers that support a given capability.
   * Pass statusFilter=null to skip the status enum check and rely solely
   * on heartbeat liveness.
   */
  async getWorkersByCapability(
    capability: WorkerCapability,
    statusFilter: WorkerStatus | null = WorkerStatus.ACTIVE,
  ): Promise<WorkerInfo[]> {
    const active = await this.getActiveWorkers();
    return active.filter(
      (w) =>
        w.capabilities.includes(capability) && (statusFilter === null || w.status === statusFilter),
    );
  }

  /** Return the number of active workers across the cluster. */
  async getWorkerCount(): Promise<number> {
    return (await this.getActiveWorkers()).length;
  }

  /** Return the number of active workers with a given capability. */
  async getWorkerCountByCapability(capability: WorkerCapability): Promise<number> {
    return (await this.getWorkersByCapability(capability)).length;
  }

  /**
   * Summarize the cluster: how many workers per capability.
   * Used by ClusterHealthService.
   */
  async getClusterSummary(): Promise<{
    totalWorkers: number;
    byCapability: Record<string, number>;
  }> {
    const workers = await this.getActiveWorkers();
    const byCapability: Record<string, number> = {};

    for (const w of workers) {
      for (const cap of w.capabilities) {
        byCapability[cap] = (byCapability[cap] ?? 0) + 1;
      }
    }

    this.logger.debug(
      `Cluster summary — total=${workers.length}, capabilities=${JSON.stringify(byCapability)}`,
      this.context,
    );

    return { totalWorkers: workers.length, byCapability };
  }
}
