import { InMemoryLockProvider } from '@infrastructure/providers/lock/in-memory-lock.provider';
import { ServiceUnavailableError } from '@common/errors/infrastructure.error';

describe('InMemoryLockProvider', () => {
  let lock: InMemoryLockProvider;

  beforeEach(() => {
    lock = new InMemoryLockProvider();
  });

  describe('acquire()', () => {
    it('acquires a free lock', async () => {
      const r = await lock.acquire('key1');
      expect(r.isOk()).toBe(true);
      if (r.isOk()) {
        expect(r.value.key).toBe('key1');
        expect(r.value.acquiredAt).toBeInstanceOf(Date);
      }
    });

    it('fails when lock is already held', async () => {
      await lock.acquire('key1');
      const r = await lock.acquire('key1');
      expect(r.isErr()).toBe(true);
      if (r.isErr()) {
        expect(r.error).toBeInstanceOf(ServiceUnavailableError);
      }
    });

    it('acquires after TTL expires', async () => {
      await lock.acquire('key1', { ttlMs: 10 });
      await new Promise((r) => setTimeout(r, 20));
      const r = await lock.acquire('key1');
      expect(r.isOk()).toBe(true);
    });
  });

  describe('release()', () => {
    it('releases a held lock', async () => {
      const acquireResult = await lock.acquire('key1');
      const handle = (
        acquireResult as {
          value: { key: string; lockId: string; acquiredAt: Date; expiresAt: Date | null };
        }
      ).value;
      const r = await lock.release(handle);
      expect(r.isOk()).toBe(true);
      expect(lock.activeLockCount).toBe(0);
    });

    it('fails when releasing a stale handle', async () => {
      const acquireResult = await lock.acquire('key1');
      const handle = (
        acquireResult as {
          value: { key: string; lockId: string; acquiredAt: Date; expiresAt: Date | null };
        }
      ).value;
      await lock.release(handle);
      const r = await lock.release(handle);
      expect(r.isErr()).toBe(true);
    });
  });

  describe('withLock()', () => {
    it('executes fn within lock and releases after', async () => {
      const r = await lock.withLock('key1', async () => 42);
      expect(r.isOk()).toBe(true);
      if (r.isOk()) expect(r.value).toBe(42);
      expect(lock.activeLockCount).toBe(0);
    });

    it('releases lock even when fn throws', async () => {
      await lock
        .withLock('key1', async () => {
          throw new Error('fn error');
        })
        .catch(() => {});
      expect(lock.activeLockCount).toBe(0);
    });
  });

  describe('isLocked()', () => {
    it('returns true when key is locked', async () => {
      await lock.acquire('key1');
      const r = await lock.isLocked('key1');
      if (r.isOk()) expect(r.value).toBe(true);
    });

    it('returns false when key is not locked', async () => {
      const r = await lock.isLocked('nope');
      if (r.isOk()) expect(r.value).toBe(false);
    });
  });
});
