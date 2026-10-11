import { RedisHashService } from '@infrastructure/redis/hash/redis-hash.service';
import { RedisClientService } from '@infrastructure/redis/redis-client.service';

const makeClient = () => {
  const store: Record<string, Record<string, string>> = {};

  return {
    hset: jest.fn(async (key: string, ...args: string[]) => {
      if (!store[key]) store[key] = {};
      for (let i = 0; i < args.length - 1; i += 2) {
        store[key][args[i]] = args[i + 1];
      }
      return 1;
    }),
    hget: jest.fn(async (key: string, field: string) => store[key]?.[field] ?? null),
    hgetall: jest.fn(async (key: string) => store[key] ?? null),
    hdel: jest.fn(async (key: string, ...fields: string[]) => {
      let count = 0;
      for (const f of fields) {
        if (store[key]?.[f]) {
          delete store[key][f];
          count++;
        }
      }
      return count;
    }),
    hexists: jest.fn(async (key: string, field: string) =>
      store[key]?.[field] !== undefined ? 1 : 0,
    ),
    hmget: jest.fn(async (key: string, ...fields: string[]) =>
      fields.map((f) => store[key]?.[f] ?? null),
    ),
    hincrbyfloat: jest.fn(async (key: string, field: string, by: number) => {
      if (!store[key]) store[key] = {};
      const current = parseFloat(store[key][field] ?? '0');
      const next = current + by;
      store[key][field] = String(next);
      return next;
    }),
    pexpire: jest.fn(async () => 1),
  };
};

describe('RedisHashService', () => {
  let service: RedisHashService;
  let mockClient: ReturnType<typeof makeClient>;

  beforeEach(() => {
    mockClient = makeClient();
    const redisClientService = {
      getClient: () => mockClient,
    } as unknown as RedisClientService;
    service = new RedisHashService(redisClientService);
  });

  it('sets and gets a numeric-string field (auto-parsed to number)', async () => {
    await service.set('pos:BTCUSDT', 'qty', '1.5');
    // The deserializer converts numeric strings to numbers
    const value = await service.get<number>('pos:BTCUSDT', 'qty');
    expect(value).toBe(1.5);
  });

  it('sets and gets a numeric field (auto-parsed)', async () => {
    await service.set('pos:BTCUSDT', 'qty', 1.5);
    const value = await service.get<number>('pos:BTCUSDT', 'qty');
    expect(value).toBe(1.5);
  });

  it('sets and gets a boolean field', async () => {
    await service.set('pos:BTCUSDT', 'isOpen', true);
    const value = await service.get<boolean>('pos:BTCUSDT', 'isOpen');
    expect(value).toBe(true);
  });

  it('sets and gets null field', async () => {
    await service.set('pos:BTCUSDT', 'exitPrice', null);
    const value = await service.get<null>('pos:BTCUSDT', 'exitPrice');
    expect(value).toBeNull();
  });

  it('returns null for missing field', async () => {
    const value = await service.get('nonexistent', 'field');
    expect(value).toBeNull();
  });

  it('setMultiple sets all fields atomically', async () => {
    await service.setMultiple('pos:BTCUSDT', { qty: 2.0, price: 50000 });
    const all = await service.getAll<Record<string, unknown>>('pos:BTCUSDT');
    expect(all?.['qty']).toBe(2);
    expect(all?.['price']).toBe(50000);
  });

  it('delete removes a field', async () => {
    await service.set('pos:BTCUSDT', 'qty', 1);
    const deleted = await service.delete('pos:BTCUSDT', 'qty');
    expect(deleted).toBe(1);
    const value = await service.get('pos:BTCUSDT', 'qty');
    expect(value).toBeNull();
  });

  it('exists returns true for present field', async () => {
    await service.set('pos:BTCUSDT', 'qty', 1);
    expect(await service.exists('pos:BTCUSDT', 'qty')).toBe(true);
  });

  it('exists returns false for absent field', async () => {
    expect(await service.exists('pos:BTCUSDT', 'missing')).toBe(false);
  });

  it('increment increases numeric field', async () => {
    await service.set('stats', 'count', 5);
    const result = await service.increment('stats', 'count', 3);
    expect(result).toBe(8);
  });

  it('setWithExpiry calls pexpire', async () => {
    await service.setWithExpiry('session:abc', { userId: 'u1' }, 60_000);
    expect(mockClient.pexpire).toHaveBeenCalledWith('session:abc', 60_000);
  });
});
