import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hostname } from 'os';
import { ClusterConfig } from '@config/cluster.config';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { WorkerInfo, WorkerCapability, WorkerStatus } from './worker-identity';

/**
 * WorkerIdService owns the identity of this worker process.
 *
 * Responsibilities:
 *  1. Resolve the stable node ID (env-override or hostname:pid)
 *  2. Parse the declared capabilities from config
 *  3. Maintain a mutable WorkerInfo that heartbeat/registry services update
 *     in place (cpuPercent, memoryBytes, activeTaskCount, lastHeartbeatAt)
 *
 * This service is a singleton (scoped to the NestJS DI module). All cluster
 * services that need to know "who am I?" inject this service.
 *
 * Why a service instead of a value provider?
 * The os.cpus() and process.memoryUsage() calls are live, so the WorkerInfo
 * must be writable and updated on each heartbeat. A frozen value object would
 * require re-creating the entire descriptor every 3 seconds; mutating a shared
 * mutable instance is cheaper and simpler.
 */
@Injectable()
export class WorkerIdService {
  private readonly context = WorkerIdService.name;

  /** Mutable identity of this worker. Written by HeartbeatService on each beat. */
  private readonly _info: WorkerInfo;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {
    const cfg = this.configService.get<ClusterConfig>('cluster')!;

    const nodeId = cfg.nodeId || `${hostname()}:${process.pid}`;
    const capabilities = this.resolveCapabilities(cfg.capabilities);

    this._info = {
      nodeId,
      nodeLabel: cfg.nodeLabel || nodeId,
      hostname: hostname(),
      pid: process.pid,
      capabilities,
      status: WorkerStatus.STARTING,
      startedAt: new Date().toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
      cpuPercent: 0,
      memoryBytes: process.memoryUsage().rss,
      activeTaskCount: 0,
    };

    this.logger.log(
      `Worker identity resolved — nodeId=${nodeId}, capabilities=[${capabilities.join(',')}]`,
      this.context,
    );
  }

  /**
   * Returns a snapshot of the current worker info.
   *
   * The object reference is shared and mutated in place by HeartbeatService.
   * Callers that need a stable snapshot should spread-copy the result.
   */
  get info(): WorkerInfo {
    return this._info;
  }

  get nodeId(): string {
    return this._info.nodeId;
  }

  /**
   * Called by HeartbeatService on each heartbeat to refresh resource metrics.
   * Uses process.cpuUsage() delta against the previous call to derive a
   * 0–100 utilization percentage over the heartbeat interval.
   */
  refreshMetrics(cpuPercent: number): void {
    const mem = process.memoryUsage();
    this._info.cpuPercent = Math.min(100, Math.max(0, cpuPercent));
    this._info.memoryBytes = mem.rss;
    this._info.lastHeartbeatAt = new Date().toISOString();
  }

  updateStatus(status: WorkerStatus): void {
    this._info.status = status;
  }

  incrementActiveTasks(): void {
    this._info.activeTaskCount++;
  }

  decrementActiveTasks(): void {
    if (this._info.activeTaskCount > 0) {
      this._info.activeTaskCount--;
    }
  }

  private resolveCapabilities(raw: string[]): WorkerCapability[] {
    const known = new Set<string>(Object.values(WorkerCapability));
    const resolved: WorkerCapability[] = [];

    for (const cap of raw) {
      if (known.has(cap)) {
        resolved.push(cap as WorkerCapability);
      } else {
        this.logger.warn(
          `Unknown worker capability "${cap}" — will be ignored. Valid: ${[...known].join(', ')}`,
          this.context,
        );
      }
    }

    if (resolved.length === 0) {
      // Fall back to all capabilities so a misconfigured node is still useful
      this.logger.warn(
        'No valid capabilities configured — defaulting to all capabilities',
        this.context,
      );
      return Object.values(WorkerCapability);
    }

    return resolved;
  }
}
