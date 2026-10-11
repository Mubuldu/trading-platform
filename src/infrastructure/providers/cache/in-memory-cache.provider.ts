import { Injectable } from '@nestjs/common';
import { ok, Result } from '@common/result';
import { InfrastructureError } from '@common/errors/infrastructure.error';
import { healthyResult, ProviderHealth } from '@infrastructure/health/health-check.interface';
import { CacheProvider, CacheSetOptions } from './cache-provider.interface';

interface CacheEntry<T> {
  value: T;
  expiresAt: number | null;
}

/**
 * InMemoryCacheProvider stores data in a process-local Map with optional TTL.
 *
 * This is the default cache in development and testing. It has zero
 * external dependencies and fully satisfies the CacheProvider interface.
 *
 * Limitations:
 *  - Data is lost on process restart (no persistence)
 *  - Data is NOT shared across multiple processes/instances
 *  - No LRU eviction — only TTL-based expiry on access
 *
 * Replace with RedisCacheProvider (Redis) for production multi-instance deployments.
 */
@Injectable()
export class InMemoryCacheProvider implements CacheProvider {
  private readonly store = new Map<string, CacheEntry<unknown>>();

  async get<T>(key: string): Promise<Result<T | null, InfrastructureError>> {
    const entry = this.store.get(key);
    if (!entry) return ok<T | null, InfrastructureError>(null);

    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return ok<T | null, InfrastructureError>(null);
    }

    return ok<T | null, InfrastructureError>(entry.value as T);
  }

  async set<T>(key: string, value: T, options?: CacheSetOptions): ReturnType<CacheProvider['set']> {
    if (options?.nx && this.store.has(key)) {
      const entry = this.store.get(key)!;
      const isExpired = entry.expiresAt !== null && Date.now() > entry.expiresAt;
      if (!isExpired) return ok(undefined);
    }

    const expiresAt = options?.ttlMs != null ? Date.now() + options.ttlMs : null;
    this.store.set(key, { value, expiresAt });
    return ok(undefined);
  }

  async delete(key: string): ReturnType<CacheProvider['delete']> {
    this.store.delete(key);
    return ok(undefined);
  }

  async exists(key: string): ReturnType<CacheProvider['exists']> {
    const entry = this.store.get(key);
    if (!entry) return ok(false);
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return ok(false);
    }
    return ok(true);
  }

  async deleteByPattern(pattern: string): ReturnType<CacheProvider['deleteByPattern']> {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    let count = 0;
    for (const key of this.store.keys()) {
      if (regex.test(key)) {
        this.store.delete(key);
        count++;
      }
    }
    return ok(count);
  }

  async clear(): ReturnType<CacheProvider['clear']> {
    this.store.clear();
    return ok(undefined);
  }

  getProviderName(): string {
    return 'in-memory-cache';
  }

  async getHealth(): Promise<ProviderHealth> {
    return healthyResult(`in-memory-cache — ${this.store.size} entries`);
  }

  get size(): number {
    return this.store.size;
  }
}
