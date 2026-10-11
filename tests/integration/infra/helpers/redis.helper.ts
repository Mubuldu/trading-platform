/**
 * Shared Redis helpers for infrastructure integration tests.
 *
 * Connection coordinates default to the test Docker container (port 6380).
 * Override via environment variables when running against a different host.
 *
 * IMPORTANT: createTestRedisClient() returns a client WITHOUT a keyPrefix,
 * so direct key lookups in tests match exactly what the service writes.
 * RiskStateService uses its own ioredis instance that carries whatever prefix
 * is configured in RedisClientService — in tests we wire both through the
 * same raw client so prefix behaviour is exercised end-to-end.
 */

import Redis from 'ioredis';

export const TEST_REDIS_HOST = process.env.TEST_REDIS_HOST ?? 'localhost';
export const TEST_REDIS_PORT = parseInt(process.env.TEST_REDIS_PORT ?? '6380', 10);

/**
 * Create an ioredis client pointed at the test container.
 *
 * @param keyPrefix - optional key prefix (e.g. 'tp:test:') — must match
 *   what is passed to the RedisClientService stub in the same test.
 */
export function createTestRedisClient(keyPrefix?: string): Redis {
  return new Redis({
    host: TEST_REDIS_HOST,
    port: TEST_REDIS_PORT,
    keyPrefix,
    lazyConnect: true,
    // Fail fast when the container is not running — tests will skip gracefully
    connectTimeout: 3_000,
    // Only 1 retry: integration tests run in an already-connected environment;
    // repeated retries waste time and obscure "container not running" signals.
    maxRetriesPerRequest: 1,
    retryStrategy: (times: number): number | null => {
      if (times > 1) return null; // stop retrying after 1 attempt
      return 200;
    },
  });
}

/**
 * Try to connect the client and return true if the server is reachable.
 * Used in beforeAll to decide whether to skip the entire test suite.
 */
export async function checkRedisAvailable(client: Redis): Promise<boolean> {
  try {
    await client.connect();
    await client.ping();
    return true;
  } catch {
    return false;
  }
}

/**
 * Drain the ioredis command queue on `client`.
 *
 * RiskStateService writes to Redis with fire-and-log (void promise chains).
 * The commands are still dispatched synchronously to the ioredis queue, so
 * a PING sent after them is guaranteed to complete after them.
 *
 * Call this after any service mutation before asserting on Redis state or
 * before constructing the "new instance" that reads back persisted state.
 */
export async function flushCommandQueue(client: Redis): Promise<void> {
  await client.ping();
}
