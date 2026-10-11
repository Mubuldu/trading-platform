import { Result } from '@common/result';
import { InfrastructureError } from '@common/errors/infrastructure.error';
import { HealthCheckable } from '@infrastructure/health/health-check.interface';

export interface LockOptions {
  ttlMs?: number;
  waitMs?: number;
  retryIntervalMs?: number;
}

export interface LockHandle {
  readonly key: string;
  readonly acquiredAt: Date;
  readonly expiresAt: Date | null;
  readonly lockId: string;
}

/**
 * LockProvider provides distributed mutual exclusion.
 *
 * Use when: two concurrent processes must not modify the same resource
 * simultaneously (e.g. two order executors updating the same position).
 *
 * The in-memory implementation is advisory only — it has no effect across
 * multiple processes. Use a Redis or database-backed implementation in
 * any multi-instance deployment.
 *
 * Always use withLock() rather than acquire()/release() directly to ensure
 * the lock is always released even when the critical section throws.
 *
 * Lock TTL prevents a crashed process from holding a lock indefinitely.
 * Always set ttlMs to a value significantly larger than the expected
 * execution time but small enough to recover from crashes promptly.
 */
export interface LockProvider extends HealthCheckable {
  acquire(key: string, options?: LockOptions): Promise<Result<LockHandle, InfrastructureError>>;
  release(handle: LockHandle): Promise<Result<void, InfrastructureError>>;
  withLock<T>(
    key: string,
    fn: () => Promise<T>,
    options?: LockOptions,
  ): Promise<Result<T, InfrastructureError>>;
  isLocked(key: string): Promise<Result<boolean, InfrastructureError>>;
  getProviderName(): string;
}
