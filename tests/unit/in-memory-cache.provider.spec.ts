import { InMemoryCacheProvider } from '@infrastructure/providers/cache/in-memory-cache.provider';

describe('InMemoryCacheProvider', () => {
  let cache: InMemoryCacheProvider;

  beforeEach(() => {
    cache = new InMemoryCacheProvider();
  });

  describe('set() / get()', () => {
    it('stores and retrieves a value', async () => {
      await cache.set('key', { price: 100 });
      const result = await cache.get<{ price: number }>('key');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual({ price: 100 });
      }
    });

    it('returns null for missing key', async () => {
      const result = await cache.get('missing');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeNull();
      }
    });

    it('returns null after TTL expires', async () => {
      await cache.set('ttl-key', 'value', { ttlMs: 10 });
      await new Promise((r) => setTimeout(r, 20));
      const result = await cache.get('ttl-key');
      if (result.isOk()) {
        expect(result.value).toBeNull();
      }
    });

    it('returns value before TTL expires', async () => {
      await cache.set('ttl-key', 'value', { ttlMs: 5000 });
      const result = await cache.get('ttl-key');
      if (result.isOk()) {
        expect(result.value).toBe('value');
      }
    });

    it('nx option skips if key exists', async () => {
      await cache.set('k', 'first');
      await cache.set('k', 'second', { nx: true });
      const result = await cache.get<string>('k');
      if (result.isOk()) {
        expect(result.value).toBe('first');
      }
    });
  });

  describe('delete()', () => {
    it('removes a key', async () => {
      await cache.set('to-delete', 'val');
      await cache.delete('to-delete');
      const result = await cache.get('to-delete');
      if (result.isOk()) expect(result.value).toBeNull();
    });

    it('is idempotent for missing keys', async () => {
      const r = await cache.delete('no-such-key');
      expect(r.isOk()).toBe(true);
    });
  });

  describe('exists()', () => {
    it('returns true for existing key', async () => {
      await cache.set('x', 1);
      const r = await cache.exists('x');
      if (r.isOk()) expect(r.value).toBe(true);
    });

    it('returns false for missing key', async () => {
      const r = await cache.exists('no');
      if (r.isOk()) expect(r.value).toBe(false);
    });

    it('returns false for expired key', async () => {
      await cache.set('exp', 1, { ttlMs: 5 });
      await new Promise((r) => setTimeout(r, 15));
      const result = await cache.exists('exp');
      if (result.isOk()) expect(result.value).toBe(false);
    });
  });

  describe('deleteByPattern()', () => {
    it('deletes keys matching a pattern', async () => {
      await cache.set('user:1', 'a');
      await cache.set('user:2', 'b');
      await cache.set('product:1', 'c');
      const r = await cache.deleteByPattern('user:*');
      if (r.isOk()) expect(r.value).toBe(2);
      expect(cache.size).toBe(1);
    });
  });

  describe('clear()', () => {
    it('removes all entries', async () => {
      await cache.set('a', 1);
      await cache.set('b', 2);
      await cache.clear();
      expect(cache.size).toBe(0);
    });
  });

  describe('getHealth()', () => {
    it('reports healthy status', async () => {
      const health = await cache.getHealth();
      expect(health.status).toBe('healthy');
    });
  });

  describe('getProviderName()', () => {
    it('returns the correct name', () => {
      expect(cache.getProviderName()).toBe('in-memory-cache');
    });
  });
});
