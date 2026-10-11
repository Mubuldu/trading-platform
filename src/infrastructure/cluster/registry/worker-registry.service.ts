import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { RedisClientService } from '@infrastructure/redis/redis-client.service';
import {
  WorkerInfo,
  WorkerCapability,
  WorkerStatus,
  serializeWorkerInfo,
  deserializeWorkerInfo,
} from '../identity/worker-identity';

/**
 * WorkerRegistryService stores and retrieves worker descriptors in Redis.
 *
 * Redis layout:
 *   cluster:workers:{nodeId}   — Hash of WorkerSnapshot fields; no TTL on the
 *                                hash itself (the heartbeat key carries the
 *                                liveness signal — see HeartbeatService)
 *   cluster:worker-index       — Set of all registered nodeIds for O(1) listing
 *
 * Why no TTL on the hash?
 * The heartbeat key (cluster:hb:{nodeId}, TTL=heartbeatTtlMs) expires
 * automatically if the process dies. The leader's dead-worker check loop reads
 * the index, looks up each worker's heartbeat key, and calls deregister() for
 * any whose heartbeat has expired. This separation keeps the worker snapshot
 * intact for post-mortem inspection while the liveness signal (heartbeat key)
 * is the authoritative source of truth.
 *
 * Thread safety:
 * All Redis operations are atomic at the command level. The worker-index Set
 * and the hash are written in a pipeline so both change in one round-trip.
 */
@Injectable()
export class WorkerRegistryService {
  private readonly context = WorkerRegistryService.name;

  private static readonly INDEX_KEY = 'cluster:worker-index';
  private static readonly WORKER_KEY_PREFIX = 'cluster:workers:';

  constructor(
    private readonly redis: RedisClientService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * Register or update a worker in the registry.
   *
   * Idempotent: calling register() on an already-registered worker overwrites
   * all fields atomically. This is the correct behaviour for reconnection
   * after a Redis failover.
   */
  async register(info: WorkerInfo): Promise<void> {
    const client = this.redis.getClient();
    const key = this.workerKey(info.nodeId);
    const snapshot = serializeWorkerInfo(info);

    const pipeline = client.pipeline();
    // HSET accepts field-value pairs as an array of alternating strings
    const flatFields: string[] = [];
    for (const [field, value] of Object.entries(snapshot)) {
      flatFields.push(field, value);
    }
    pipeline.hset(key, ...flatFields);
    pipeline.sadd(WorkerRegistryService.INDEX_KEY, info.nodeId);
    await pipeline.exec();

    this.logger.debug(
      `Worker registered: nodeId=${info.nodeId}, capabilities=[${info.capabilities.join(',')}]`,
      this.context,
    );
  }

  /**
   * Update specific fields of a registered worker without overwriting all fields.
   * Used by HeartbeatService to refresh metrics without rewriting the entire hash.
   */
  async updateFields(nodeId: string, fields: Partial<Record<string, string>>): Promise<void> {
    const client = this.redis.getClient();
    const key = this.workerKey(nodeId);
    const flatFields: string[] = [];
    for (const [field, value] of Object.entries(fields)) {
      if (value !== undefined) {
        flatFields.push(field, value);
      }
    }
    if (flatFields.length > 0) {
      await client.hset(key, ...flatFields);
    }
  }

  /**
   * Remove a worker from the registry. Called by the leader when a heartbeat
   * key expires (worker crashed) or by the worker itself on graceful shutdown.
   */
  async deregister(nodeId: string): Promise<void> {
    const client = this.redis.getClient();
    const pipeline = client.pipeline();
    pipeline.del(this.workerKey(nodeId));
    pipeline.srem(WorkerRegistryService.INDEX_KEY, nodeId);
    await pipeline.exec();

    this.logger.log(`Worker deregistered: nodeId=${nodeId}`, this.context);
  }

  /**
   * Return info for a specific worker. Returns null when the worker is not
   * registered (either was never registered or was already deregistered).
   */
  async getWorker(nodeId: string): Promise<WorkerInfo | null> {
    const client = this.redis.getClient();
    const snapshot = await client.hgetall(this.workerKey(nodeId));
    if (!snapshot || Object.keys(snapshot).length === 0) return null;
    return deserializeWorkerInfo(snapshot);
  }

  /**
   * Return all registered workers. Includes workers whose heartbeat may have
   * expired but whose deregistration has not yet run. Callers should filter
   * by status or by checking the heartbeat key independently.
   */
  async getAllWorkers(): Promise<WorkerInfo[]> {
    const client = this.redis.getClient();
    const nodeIds = await client.smembers(WorkerRegistryService.INDEX_KEY);
    if (nodeIds.length === 0) return [];

    const pipeline = client.pipeline();
    for (const id of nodeIds) {
      pipeline.hgetall(this.workerKey(id));
    }
    const results = await pipeline.exec();

    const workers: WorkerInfo[] = [];
    for (const result of results ?? []) {
      const [err, snapshot] = result as [Error | null, Record<string, string> | null];
      if (!err && snapshot && Object.keys(snapshot).length > 0) {
        workers.push(deserializeWorkerInfo(snapshot));
      }
    }
    return workers;
  }

  /**
   * Return only workers that advertise the requested capability.
   * Status filter defaults to ACTIVE; pass null to return all statuses.
   */
  async getWorkersByCapability(
    capability: WorkerCapability,
    statusFilter: WorkerStatus | null = WorkerStatus.ACTIVE,
  ): Promise<WorkerInfo[]> {
    const all = await this.getAllWorkers();
    return all.filter(
      (w) =>
        w.capabilities.includes(capability) && (statusFilter === null || w.status === statusFilter),
    );
  }

  /**
   * Return the set of all registered nodeIds. Cheaper than getAllWorkers()
   * when only presence is needed.
   */
  async getRegisteredNodeIds(): Promise<string[]> {
    const client = this.redis.getClient();
    return client.smembers(WorkerRegistryService.INDEX_KEY);
  }

  private workerKey(nodeId: string): string {
    return `${WorkerRegistryService.WORKER_KEY_PREFIX}${nodeId}`;
  }
}
