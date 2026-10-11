import { Injectable } from '@nestjs/common';
import { ok, err, Result } from '@common/result';
import {
  InfrastructureError,
  SerializationError,
  ServiceUnavailableError,
} from '@common/errors/infrastructure.error';
import {
  healthyResult,
  degradedResult,
  ProviderHealth,
} from '@infrastructure/health/health-check.interface';
import { RedisClientService } from '@infrastructure/redis/redis-client.service';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { CacheProvider, CacheSetOptions } from './cache-provider.interface';

/**
 * RedisCacheProvider implements CacheProvider backed by a Redis instance.
 *
 * Serialization:
 *   Values are JSON-serialized before writing (SET) and deserialized on read
 *   (GET). This adds a small constant overhead (~1 µs) per operation but
 *   supports arbitrary TypeScript types (including nested objects and arrays).
 *   Callers store typed values; the provider handles the wire format.
 *
 * TTL handling:
 *   options.ttlMs → Redis PX (millisecond precision TTL).
 *   Omitting ttlMs stores the key without expiry — it persists until explicit
 *   delete or Redis eviction (maxmemory-policy). Trading platform caches
 *   should always pass ttlMs to prevent unbounded memory growth.
 *
 * NX (set-if-not-exists):
 *   options.nx=true → Redis SET NX PX. Atomic: no separate GET then SET.
 *   Used by distributed locks and deduplication keys.
 *
 * deleteByPattern:
 *   Uses SCAN + UNLINK. SCAN is non-blocking (cursor-based); UNLINK is
 *   async DEL. Never uses KEYS (blocks Redis for entire keyset scan).
 *   Pattern syntax: only '*' wildcard is supported (converted to SCAN match).
 *
 * Key namespacing:
 *   The Redis key prefix (tp: by default) is applied by ioredis via the
 *   keyPrefix option on the RedisClientService connection. Callers do NOT
 *   include the prefix in keys passed to this provider.
 */
@Injectable()
export class RedisCacheProvider implements CacheProvider {
  private readonly context = RedisCacheProvider.name;

  constructor(
    private readonly redis: RedisClientService,
    private readonly logger: AppLoggerService,
  ) {}

  async get<T>(key: string): Promise<Result<T | null, InfrastructureError>> {
    try {
      const client = this.redis.getClient();
      const raw = await client.get(key);
      if (raw === null) return ok<T | null>(null);

      try {
        return ok<T | null>(JSON.parse(raw) as T);
      } catch {
        return err(
          new SerializationError(`Failed to deserialize cache value for key "${key}"`, { key }),
        );
      }
    } catch (error) {
      return err(
        new ServiceUnavailableError(
          `Cache GET failed for key "${key}": ${error instanceof Error ? error.message : String(error)}`,
          { key },
          error instanceof Error ? error : undefined,
        ),
      );
    }
  }

  async set<T>(key: string, value: T, options?: CacheSetOptions): ReturnType<CacheProvider['set']> {
    try {
      let serialized: string;
      try {
        serialized = JSON.stringify(value);
      } catch {
        return err(
          new SerializationError(`Failed to serialize cache value for key "${key}"`, { key }),
        );
      }

      const client = this.redis.getClient();

      if (options?.nx && options?.ttlMs != null) {
        // ioredis 6.x: PX <ms> must precede NX in positional overload.
        await client.set(key, serialized, 'PX', options.ttlMs, 'NX');
      } else if (options?.nx) {
        await client.set(key, serialized, 'NX');
      } else if (options?.ttlMs != null) {
        await client.set(key, serialized, 'PX', options.ttlMs);
      } else {
        await client.set(key, serialized);
      }

      return ok(undefined);
    } catch (error) {
      return err(
        new ServiceUnavailableError(
          `Cache SET failed for key "${key}": ${error instanceof Error ? error.message : String(error)}`,
          { key },
          error instanceof Error ? error : undefined,
        ),
      );
    }
  }

  async delete(key: string): ReturnType<CacheProvider['delete']> {
    try {
      const client = this.redis.getClient();
      await client.unlink(key);
      return ok(undefined);
    } catch (error) {
      return err(
        new ServiceUnavailableError(
          `Cache DELETE failed for key "${key}": ${error instanceof Error ? error.message : String(error)}`,
          { key },
          error instanceof Error ? error : undefined,
        ),
      );
    }
  }

  async exists(key: string): ReturnType<CacheProvider['exists']> {
    try {
      const client = this.redis.getClient();
      const count = await client.exists(key);
      return ok(count === 1);
    } catch (error) {
      return err(
        new ServiceUnavailableError(
          `Cache EXISTS failed for key "${key}": ${error instanceof Error ? error.message : String(error)}`,
          { key },
          error instanceof Error ? error : undefined,
        ),
      );
    }
  }

  async deleteByPattern(pattern: string): ReturnType<CacheProvider['deleteByPattern']> {
    try {
      const client = this.redis.getClient();
      let deleted = 0;
      let cursor = '0';

      do {
        // SCAN is the non-blocking alternative to KEYS for pattern matching
        const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;

        if (keys.length > 0) {
          await client.unlink(...keys);
          deleted += keys.length;
        }
      } while (cursor !== '0');

      this.logger.debug(`deleteByPattern("${pattern}") removed ${deleted} keys`, this.context);
      return ok(deleted);
    } catch (error) {
      return err(
        new ServiceUnavailableError(
          `Cache deleteByPattern failed for pattern "${pattern}": ${error instanceof Error ? error.message : String(error)}`,
          { pattern },
          error instanceof Error ? error : undefined,
        ),
      );
    }
  }

  async clear(): ReturnType<CacheProvider['clear']> {
    // FLUSHDB would clear ALL keys in the database, not just cache keys.
    // Use deleteByPattern with '*' to limit impact to the current key prefix.
    return this.deleteByPattern('*').then((r) => (r.isOk() ? ok(undefined) : err(r.error)));
  }

  getProviderName(): string {
    return 'redis-cache';
  }

  async getHealth(): Promise<ProviderHealth> {
    if (!this.redis.isConnected()) {
      return degradedResult('Redis not connected — cache unavailable');
    }
    try {
      const latencyMs = await this.redis.ping();
      return healthyResult(`redis-cache — latency=${latencyMs}ms`, latencyMs);
    } catch (err) {
      return degradedResult(
        `redis-cache ping failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
