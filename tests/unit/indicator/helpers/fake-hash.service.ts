import { RedisHashService } from '../../../../src/infrastructure/redis/hash/redis-hash.service';

export function makeFakeHashService(): jest.Mocked<RedisHashService> {
  const store: Record<string, Record<string, string>> = {};
  return {
    set: jest.fn(async (key: string, field: string, value: string | number | boolean | null) => {
      if (!store[key]) store[key] = {};
      store[key][field] = String(value);
    }),
    setMultiple: jest.fn(),
    get: jest.fn(async (key: string, field: string) => store[key]?.[field] ?? null),
    getAll: jest.fn(async (key: string) => store[key] ?? null),
    delete: jest.fn(async () => 0),
    exists: jest.fn(async () => false),
    increment: jest.fn(async () => 0),
    getFields: jest.fn(async () => []),
    setWithExpiry: jest.fn(),
    getStore: () => store,
  } as unknown as jest.Mocked<RedisHashService> & { getStore: () => typeof store };
}
