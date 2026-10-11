import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ok, err } from '@common/result';
import { ServiceUnavailableError, InfrastructureError } from '@common/errors/infrastructure.error';
import { healthyResult, ProviderHealth } from '@infrastructure/health/health-check.interface';
import { LockProvider, LockOptions, LockHandle } from './lock-provider.interface';

/**
 * InMemoryLockProvider implements advisory distributed locks within a single
 * process. It is suitable for development, testing, and single-instance
 * deployments only.
 *
 * In a multi-instance deployment, each process has its own lock store and
 * locks provide NO mutual exclusion across instances. Use a Redis-backed
 * or database-backed implementation for true distributed locking.
 *
 * Expired locks (TTL elapsed) are released automatically on the next
 * acquire() or isLocked() call for the same key. No background janitor
 * is needed for the in-memory case.
 */
@Injectable()
export class InMemoryLockProvider implements LockProvider {
  private readonly locks = new Map<string, LockHandle>();

  async acquire(key: string, options?: LockOptions): ReturnType<LockProvider['acquire']> {
    const existing = this.locks.get(key);
    if (existing) {
      const isExpired = existing.expiresAt !== null && Date.now() > existing.expiresAt.getTime();
      if (!isExpired) {
        return err(
          new ServiceUnavailableError(`Lock "${key}" is already held`, {
            key,
            acquiredAt: existing.acquiredAt.toISOString(),
          }),
        );
      }
      this.locks.delete(key);
    }

    const handle: LockHandle = {
      key,
      lockId: randomUUID(),
      acquiredAt: new Date(),
      expiresAt: options?.ttlMs != null ? new Date(Date.now() + options.ttlMs) : null,
    };

    this.locks.set(key, handle);
    return ok(handle);
  }

  async release(handle: LockHandle): ReturnType<LockProvider['release']> {
    const current = this.locks.get(handle.key);
    if (!current || current.lockId !== handle.lockId) {
      return err(
        new ServiceUnavailableError(
          `Cannot release lock "${handle.key}" — handle is stale or lock was already released`,
        ),
      );
    }
    this.locks.delete(handle.key);
    return ok(undefined);
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
    const existing = this.locks.get(key);
    if (!existing) return ok(false);
    if (existing.expiresAt !== null && Date.now() > existing.expiresAt.getTime()) {
      this.locks.delete(key);
      return ok(false);
    }
    return ok(true);
  }

  getProviderName(): string {
    return 'in-memory-lock';
  }

  async getHealth(): Promise<ProviderHealth> {
    return healthyResult(`in-memory-lock — ${this.locks.size} active locks`);
  }

  get activeLockCount(): number {
    return this.locks.size;
  }
}
