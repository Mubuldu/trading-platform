import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { ok, err } from '@common/result';
import { ServiceUnavailableError, InfrastructureError } from '@common/errors/infrastructure.error';
import {
  healthyResult,
  degradedResult,
  ProviderHealth,
} from '@infrastructure/health/health-check.interface';
import { RedisClientService } from '@infrastructure/redis/redis-client.service';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { ClusterConfig } from '@config/cluster.config';
import { LockProvider, LockOptions, LockHandle } from './lock-provider.interface';

/**
 * RedisLockProvider implements distributed advisory locks using Redis.
 *
 * Protocol (single-node Redlock-light):
 *   Acquire: SET key <lockId> NX PX ttlMs
 *   Release: Lua script — GET key, compare lockId, DEL if match
 *   Extend:  Lua script — GET key, compare lockId, PEXPIRE if match
 *
 * Why a Lua script for release?
 * Without atomicity, a thread could: (1) GET and confirm lockId matches,
 * (2) be paused by the OS, (3) have the TTL expire and another thread acquire
 * the lock, (4) resume and incorrectly DEL the new lock. The Lua script
 * runs atomically on the Redis server, making this race impossible.
 *
 * Retry loop (when waitMs > 0):
 * Retries are spaced by retryIntervalMs ± jitter (uniformly random in
 * [0, jitterMs]). Jitter prevents a thundering herd when many callers race
 * for the same lock simultaneously — staggered retries spread the load.
 *
 * Lock TTL strategy:
 * Always set a TTL. A caller that crashes while holding a lock would hold
 * it forever without TTL. TTL must be significantly larger than the expected
 * critical section duration but short enough that a crashed holder's lock is
 * recovered promptly. The caller passes ttlMs in LockOptions; default is
 * CLUSTER_DEFAULT_LOCK_TTL_MS (30 s).
 *
 * Scope:
 * Lock keys are prefixed with the Redis key prefix (tp: by default) so they
 * are namespaced away from application keys. The caller must choose a key
 * that is unique to the resource being protected (e.g. 'lock:order:{orderId}').
 *
 * Multi-node Redlock:
 * True multi-node Redlock requires N ≥ 3 independent Redis instances for
 * quorum. This implementation targets a single logical Redis (standalone,
 * Sentinel, or Cluster). For multi-DC failover safety, replace the acquire
 * logic with multi-node quorum writes. The interface remains unchanged.
 */
@Injectable()
export class RedisLockProvider implements LockProvider {
  private readonly context = RedisLockProvider.name;

  private static readonly RELEASE_SCRIPT = `
    local val = redis.call('GET', KEYS[1])
    if val == ARGV[1] then
      return redis.call('DEL', KEYS[1])
    else
      return 0
    end
  `;

  private readonly defaultTtlMs: number;
  private readonly defaultWaitMs: number;
  private readonly defaultRetryIntervalMs: number;
  private readonly defaultJitterMs: number;

  constructor(
    private readonly redis: RedisClientService,
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {
    const cfg = this.configService.get<ClusterConfig>('cluster')!;
    this.defaultTtlMs = cfg.defaultLockTtlMs;
    this.defaultWaitMs = cfg.lockWaitMs;
    this.defaultRetryIntervalMs = cfg.lockRetryIntervalMs;
    this.defaultJitterMs = cfg.lockRetryJitterMs;
  }

  async acquire(key: string, options?: LockOptions): ReturnType<LockProvider['acquire']> {
    const client = this.redis.getClient();
    const lockId = randomUUID();
    const ttlMs = options?.ttlMs ?? this.defaultTtlMs;
    const waitMs = options?.waitMs ?? this.defaultWaitMs;
    const retryIntervalMs = options?.retryIntervalMs ?? this.defaultRetryIntervalMs;

    const deadline = Date.now() + waitMs;

    do {
      // ioredis 6.x: PX <ms> must precede NX in positional overload.
      const result = await client.set(key, lockId, 'PX', ttlMs, 'NX');

      if (result === 'OK') {
        const handle: LockHandle = {
          key,
          lockId,
          acquiredAt: new Date(),
          expiresAt: new Date(Date.now() + ttlMs),
        };
        this.logger.debug(`Lock acquired: key=${key}, ttlMs=${ttlMs}`, this.context);
        return ok(handle);
      }

      // Already held — wait before retrying
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;

      const jitter = Math.floor(Math.random() * this.defaultJitterMs);
      const sleep = Math.min(retryIntervalMs + jitter, remaining);
      await this.delay(sleep);
    } while (Date.now() < deadline);

    return err(
      new ServiceUnavailableError(`Could not acquire lock "${key}" within ${waitMs}ms`, {
        key,
        waitMs,
        ttlMs,
      }),
    );
  }

  async release(handle: LockHandle): ReturnType<LockProvider['release']> {
    try {
      const client = this.redis.getClient();
      const deleted = (await client.eval(
        RedisLockProvider.RELEASE_SCRIPT,
        1,
        handle.key,
        handle.lockId,
      )) as number;

      if (deleted === 0) {
        return err(
          new ServiceUnavailableError(
            `Cannot release lock "${handle.key}" — handle is stale (lock expired or was taken)`,
            { key: handle.key, lockId: handle.lockId },
          ),
        );
      }

      this.logger.debug(`Lock released: key=${handle.key}`, this.context);
      return ok(undefined);
    } catch (error) {
      return err(
        new ServiceUnavailableError(
          `Lock release failed for "${handle.key}": ${error instanceof Error ? error.message : String(error)}`,
          { key: handle.key },
          error instanceof Error ? error : undefined,
        ),
      );
    }
  }

  async withLock<T>(
    key: string,
    fn: () => Promise<T>,
    options?: LockOptions,
  ): Promise<ReturnType<typeof ok<T>> | ReturnType<typeof err<T, InfrastructureError>>> {
    const acquireResult = await this.acquire(key, options);
    if (acquireResult.isErr()) return err(acquireResult.error);

    const handle = acquireResult.value;
    try {
      const result = await fn();
      await this.release(handle);
      return ok(result);
    } catch (error) {
      await this.release(handle).catch(() => {});
      throw error;
    }
  }

  async isLocked(key: string): ReturnType<LockProvider['isLocked']> {
    try {
      const client = this.redis.getClient();
      const exists = await client.exists(key);
      return ok(exists === 1);
    } catch (error) {
      return err(
        new ServiceUnavailableError(
          `isLocked check failed for "${key}": ${error instanceof Error ? error.message : String(error)}`,
          { key },
          error instanceof Error ? error : undefined,
        ),
      );
    }
  }

  getProviderName(): string {
    return 'redis-lock';
  }

  async getHealth(): Promise<ProviderHealth> {
    if (!this.redis.isConnected()) {
      return degradedResult('Redis not connected — lock provider is unavailable');
    }
    return healthyResult('redis-lock — connected');
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
