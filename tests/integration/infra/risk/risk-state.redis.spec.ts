/**
 * RiskStateService — real Redis integration tests
 *
 * These tests verify what unit tests with mock clients cannot:
 *
 *   1. Cross-instance persistence: state written by "instance A" is correctly
 *      restored by "instance B" via onModuleInit() — simulating a pod restart.
 *
 *   2. Wire format correctness: ioredis keyPrefix is applied transparently,
 *      so the keys RiskStateService writes are prefixed at the network level.
 *      A direct client.get() with the same prefix confirms the exact on-wire key.
 *
 *   3. Fire-and-log timing: RiskStateService uses "void promise" writes
 *      (never awaited by the caller). flushCommandQueue() confirms these
 *      commands complete before the next instance reads them.
 *
 *   4. Daily state accumulation: multiple trades in succession, then restore.
 *
 *   5. UTC day boundary: a stored dayStart from yesterday is silently
 *      discarded on restore — daily counters start at zero.
 *
 * Requires: docker compose -f docker-compose.test.yml up -d --wait
 *
 * When the container is not running, every test returns early (trivial pass).
 * The suite prints a clear warning so the skip is never silent.
 */

import Redis from 'ioredis';
import { RiskStateService } from '@modules/risk/application/services/risk-state.service';
import { RedisClientService } from '@infrastructure/redis/redis-client.service';
import {
  createTestRedisClient,
  checkRedisAvailable,
  flushCommandQueue,
  TEST_REDIS_HOST,
  TEST_REDIS_PORT,
} from '../helpers/redis.helper';

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Key prefix used by this test suite — must be the same for both the direct
 *  client and the RedisClientService adapter so keys are co-located. */
const KEY_PREFIX = 'tp:itest:risk:';

/** Key names as RiskStateService hardcodes them (without prefix). */
const RKEY = {
  KILL_SWITCH: 'risk:state:kill-switch',
  TRADING_PAUSED: 'risk:state:trading-paused',
  EXPOSURE_LOCKED: 'risk:state:exposure-locked',
  DAILY: 'risk:state:daily',
} as const;

const MS_PER_DAY = 86_400_000;

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Minimal duck-typed adapter — RedisClientService is not injectable in plain
 * unit/integration tests, but RiskStateService only needs getClient().
 * Casting to `unknown as RedisClientService` avoids pulling in the full
 * NestJS DI context and ConfigService.
 */
function makeAdapter(client: Redis): RedisClientService {
  return { getClient: () => client } as unknown as RedisClientService;
}

/** Construct a RiskStateService wired to the given ioredis client. */
function makeService(client: Redis): RiskStateService {
  return new RiskStateService(makeAdapter(client), undefined /* no logger noise */);
}

// ─── Suite ─────────────────────────────────────────────────────────────────────

describe('RiskStateService — real Redis persistence', () => {
  let redis: Redis;
  let available = false;

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  beforeAll(async () => {
    redis = createTestRedisClient(KEY_PREFIX);
    available = await checkRedisAvailable(redis);

    if (!available) {
      console.warn(
        `\n⚠  Redis not reachable at ${TEST_REDIS_HOST}:${TEST_REDIS_PORT} — skipping infra tests.` +
          `\n   Start the test containers: docker compose -f docker-compose.test.yml up -d --wait\n`,
      );
    }
  }, 10_000);

  afterAll(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    if (!available) return;
    // FLUSHDB wipes the dedicated test container — safe because it is isolated
    // on port 6380 and contains nothing but test data.
    await redis.flushdb();
  });

  // ── Guard helper ─────────────────────────────────────────────────────────────

  /** Skip the calling test body when Docker is not available. */
  function skipIfUnavailable(): boolean {
    if (!available) return true;
    return false;
  }

  // ── Control-flag persistence ─────────────────────────────────────────────────

  it('kill switch survives a process restart (cross-instance restore)', async () => {
    if (skipIfUnavailable()) return;

    // ── Instance A: engage kill switch
    const svcA = makeService(redis);
    svcA.triggerKillSwitch();
    await flushCommandQueue(redis); // drain fire-and-log writes

    // ── Instance B: simulate restart — restores from Redis
    const svcB = makeService(redis);
    await svcB.onModuleInit();

    expect(svcB.isKillSwitchActive()).toBe(true);
  });

  it('resetKillSwitch() removes the key so the next instance starts clean', async () => {
    if (skipIfUnavailable()) return;

    const svcA = makeService(redis);
    svcA.triggerKillSwitch();
    await flushCommandQueue(redis);
    svcA.resetKillSwitch();
    await flushCommandQueue(redis);

    const svcB = makeService(redis);
    await svcB.onModuleInit();

    expect(svcB.isKillSwitchActive()).toBe(false);
  });

  it('trading pause survives a restart', async () => {
    if (skipIfUnavailable()) return;

    const svcA = makeService(redis);
    svcA.pauseTrading();
    await flushCommandQueue(redis);

    const svcB = makeService(redis);
    await svcB.onModuleInit();

    expect(svcB.isTradingPaused()).toBe(true);
    expect(svcB.isExposureLocked()).toBe(false);
  });

  it('exposure lock survives a restart', async () => {
    if (skipIfUnavailable()) return;

    const svcA = makeService(redis);
    svcA.lockExposure();
    await flushCommandQueue(redis);

    const svcB = makeService(redis);
    await svcB.onModuleInit();

    expect(svcB.isExposureLocked()).toBe(true);
    expect(svcB.isTradingPaused()).toBe(false);
  });

  it('resume() clears both pause and exposure lock, so next instance sees neither', async () => {
    if (skipIfUnavailable()) return;

    const svcA = makeService(redis);
    svcA.pauseTrading();
    svcA.lockExposure();
    await flushCommandQueue(redis);
    svcA.resume();
    await flushCommandQueue(redis);

    const svcB = makeService(redis);
    await svcB.onModuleInit();

    expect(svcB.isTradingPaused()).toBe(false);
    expect(svcB.isExposureLocked()).toBe(false);
  });

  it('all three control flags restore simultaneously', async () => {
    if (skipIfUnavailable()) return;

    const svcA = makeService(redis);
    svcA.triggerKillSwitch();
    svcA.pauseTrading();
    svcA.lockExposure();
    await flushCommandQueue(redis);

    const svcB = makeService(redis);
    await svcB.onModuleInit();

    expect(svcB.isKillSwitchActive()).toBe(true);
    expect(svcB.isTradingPaused()).toBe(true);
    expect(svcB.isExposureLocked()).toBe(true);
  });

  // ── Wire-format / keyPrefix correctness ─────────────────────────────────────

  it('persists kill switch to the correct prefixed Redis key', async () => {
    if (skipIfUnavailable()) return;

    const svc = makeService(redis);
    svc.triggerKillSwitch();
    await flushCommandQueue(redis);

    // redis has KEY_PREFIX configured, so get('risk:state:kill-switch') looks
    // up '{KEY_PREFIX}risk:state:kill-switch' on the wire — exactly what the
    // service wrote.
    const value = await redis.get(RKEY.KILL_SWITCH);
    expect(value).toBe('1');
  });

  it('resetKillSwitch() deletes the key (not just sets it to 0)', async () => {
    if (skipIfUnavailable()) return;

    const svc = makeService(redis);
    svc.triggerKillSwitch();
    await flushCommandQueue(redis);
    svc.resetKillSwitch();
    await flushCommandQueue(redis);

    // Key must be absent, not '0'
    const value = await redis.get(RKEY.KILL_SWITCH);
    expect(value).toBeNull();
  });

  it('pause uses DEL on clear (key absent after resume)', async () => {
    if (skipIfUnavailable()) return;

    const svc = makeService(redis);
    svc.pauseTrading();
    await flushCommandQueue(redis);
    svc.resume();
    await flushCommandQueue(redis);

    expect(await redis.get(RKEY.TRADING_PAUSED)).toBeNull();
    expect(await redis.get(RKEY.EXPOSURE_LOCKED)).toBeNull();
  });

  // ── Daily state persistence ──────────────────────────────────────────────────

  it('daily loss accumulates across multiple losing trades and restores correctly', async () => {
    if (skipIfUnavailable()) return;

    const svcA = makeService(redis);
    svcA.initEquity(100_000);
    svcA.recordTrade(-300); // loss: 300
    svcA.recordTrade(-200); // loss: 500
    svcA.recordTrade(-100); // loss: 600
    await flushCommandQueue(redis);

    const svcB = makeService(redis);
    await svcB.onModuleInit();

    expect(svcB.getDailyLoss()).toBeCloseTo(600);
  });

  it('daily trade count restores correctly after mixed wins and losses', async () => {
    if (skipIfUnavailable()) return;

    const svcA = makeService(redis);
    svcA.initEquity(100_000);
    svcA.recordTrade(100);  // win  — count 1
    svcA.recordTrade(-50);  // loss — count 2
    svcA.recordTrade(75);   // win  — count 3
    svcA.recordTrade(-150); // loss — count 4
    await flushCommandQueue(redis);

    const svcB = makeService(redis);
    await svcB.onModuleInit();

    // Daily loss = 50 + 150 = 200; trade count = 4
    expect(svcB.getDailyTradeCount()).toBe(4);
    expect(svcB.getDailyLoss()).toBeCloseTo(200);
  });

  it('wins do not inflate the daily loss counter', async () => {
    if (skipIfUnavailable()) return;

    const svcA = makeService(redis);
    svcA.initEquity(100_000);
    svcA.recordTrade(500);
    svcA.recordTrade(300);
    svcA.recordTrade(200);
    await flushCommandQueue(redis);

    const svcB = makeService(redis);
    await svcB.onModuleInit();

    expect(svcB.getDailyLoss()).toBe(0);
    expect(svcB.getDailyTradeCount()).toBe(3);
  });

  // ── UTC day boundary ─────────────────────────────────────────────────────────

  it('stale daily state from a prior UTC day is silently discarded on restore', async () => {
    if (skipIfUnavailable()) return;

    // Write a daily hash that looks like it came from yesterday
    const todayDay = Math.floor(Date.now() / MS_PER_DAY);
    const yesterdayTs = (todayDay - 1) * MS_PER_DAY + 500; // 500 ms into yesterday UTC

    // Write directly via the same prefixed client — simulates what a prior
    // instance of RiskStateService would have written before midnight rolled.
    await redis.hset(RKEY.DAILY, {
      loss: '9999',
      tradeCount: '99',
      dayStart: String(yesterdayTs),
    });

    const svc = makeService(redis);
    await svc.onModuleInit();

    // Yesterday's loss must NOT count against today's risk limits
    expect(svc.getDailyLoss()).toBe(0);
    expect(svc.getDailyTradeCount()).toBe(0);
  });

  it('same-day daily state is restored even when written near UTC midnight', async () => {
    if (skipIfUnavailable()) return;

    // Simulate a restart 1 minute before midnight (dayStart = today at 23:59)
    const todayDay = Math.floor(Date.now() / MS_PER_DAY);
    const lateNightTs = todayDay * MS_PER_DAY + (23 * 3_600_000 + 59 * 60_000);

    await redis.hset(RKEY.DAILY, {
      loss: '1250.75',
      tradeCount: '12',
      dayStart: String(lateNightTs),
    });

    const svc = makeService(redis);
    await svc.onModuleInit();

    expect(svc.getDailyLoss()).toBeCloseTo(1250.75);
    expect(svc.getDailyTradeCount()).toBe(12);
  });

  // ── Fault tolerance ──────────────────────────────────────────────────────────

  it('fresh instance starts with clean state when no keys are present', async () => {
    if (skipIfUnavailable()) return;

    // Redis was flushed in beforeEach — no keys at all
    const svc = makeService(redis);
    await svc.onModuleInit();

    expect(svc.isKillSwitchActive()).toBe(false);
    expect(svc.isTradingPaused()).toBe(false);
    expect(svc.isExposureLocked()).toBe(false);
    expect(svc.getDailyLoss()).toBe(0);
    expect(svc.getDailyTradeCount()).toBe(0);
  });

  it('in-memory state is always mutated immediately, regardless of Redis flush timing', async () => {
    if (skipIfUnavailable()) return;

    // The kill switch is effective in-memory BEFORE the Redis write completes.
    // This test asserts the synchronous in-memory side-effect, then separately
    // confirms the write landed (via the cross-instance restore test above).
    const svc = makeService(redis);
    svc.triggerKillSwitch();

    // No flush needed — in-memory flag is set synchronously
    expect(svc.isKillSwitchActive()).toBe(true);
    await flushCommandQueue(redis); // clean up for next test
  });
});
