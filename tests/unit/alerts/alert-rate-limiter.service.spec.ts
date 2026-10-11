import { AlertRateLimiterService } from '@modules/alerts/application/services/alert-rate-limiter.service';
import { AlertCategory } from '@modules/alerts/domain/alert-category.enum';
import { AlertCondition } from '@modules/alerts/domain/alert-condition.enum';
import { ConfigService } from '@nestjs/config';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { RedisClientService } from '@infrastructure/redis/redis-client.service';

const MOCK_CONFIG = {
  cooldownSeconds: 300,
  escalationThreshold: 3,
  escalationWindowSeconds: 900,
};

describe('AlertRateLimiterService', () => {
  let service: AlertRateLimiterService;
  let mockRedis: jest.Mocked<RedisClientService>;
  let mockClient: Record<string, jest.Mock>;
  let configService: jest.Mocked<ConfigService>;
  let logger: jest.Mocked<AppLoggerService>;

  beforeEach(() => {
    mockClient = {
      ttl: jest.fn().mockResolvedValue(-1),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
    };

    mockRedis = {
      getClient: jest.fn().mockReturnValue(mockClient),
    } as unknown as jest.Mocked<RedisClientService>;

    configService = {
      get: jest.fn().mockReturnValue(MOCK_CONFIG),
    } as unknown as jest.Mocked<ConfigService>;

    logger = {
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<AppLoggerService>;

    service = new AlertRateLimiterService(configService, mockRedis, logger);
  });

  // ── buildFingerprint ───────────────────────────────────────────────────────

  describe('buildFingerprint()', () => {
    it('produces a 64-character hex string', () => {
      const fp = AlertRateLimiterService.buildFingerprint(
        AlertCategory.EXCHANGE,
        AlertCondition.EXCHANGE_DISCONNECT,
        'BinanceAdapter',
      );
      expect(fp).toHaveLength(64);
      expect(/^[0-9a-f]+$/.test(fp)).toBe(true);
    });

    it('is deterministic for the same inputs', () => {
      const a = AlertRateLimiterService.buildFingerprint(
        AlertCategory.REDIS,
        AlertCondition.REDIS_DISCONNECT,
        'RedisService',
      );
      const b = AlertRateLimiterService.buildFingerprint(
        AlertCategory.REDIS,
        AlertCondition.REDIS_DISCONNECT,
        'RedisService',
      );
      expect(a).toBe(b);
    });

    it('differs for different conditions', () => {
      const a = AlertRateLimiterService.buildFingerprint(
        AlertCategory.EXCHANGE,
        AlertCondition.EXCHANGE_DISCONNECT,
        'SrcA',
      );
      const b = AlertRateLimiterService.buildFingerprint(
        AlertCategory.EXCHANGE,
        AlertCondition.EXCHANGE_HIGH_LATENCY,
        'SrcA',
      );
      expect(a).not.toBe(b);
    });

    it('differs for different sources', () => {
      const a = AlertRateLimiterService.buildFingerprint(
        AlertCategory.EXCHANGE,
        AlertCondition.EXCHANGE_DISCONNECT,
        'AdapterA',
      );
      const b = AlertRateLimiterService.buildFingerprint(
        AlertCategory.EXCHANGE,
        AlertCondition.EXCHANGE_DISCONNECT,
        'AdapterB',
      );
      expect(a).not.toBe(b);
    });
  });

  // ── checkCooldown ──────────────────────────────────────────────────────────

  describe('checkCooldown()', () => {
    it('returns suppressed=false when TTL is -1 (key absent)', async () => {
      mockClient.ttl.mockResolvedValue(-1);
      mockClient.get.mockResolvedValue(null);

      const state = await service.checkCooldown('fp1');
      expect(state.suppressed).toBe(false);
      expect(state.suppressedCount).toBe(0);
      expect(state.cooldownRemainingSeconds).toBe(0);
    });

    it('returns suppressed=true when cooldown TTL > 0', async () => {
      mockClient.ttl.mockResolvedValue(120);
      mockClient.get.mockResolvedValue('2');

      const state = await service.checkCooldown('fp2');
      expect(state.suppressed).toBe(true);
      expect(state.suppressedCount).toBe(2);
      expect(state.cooldownRemainingSeconds).toBe(120);
    });

    it('falls back to in-memory when Redis throws', async () => {
      mockRedis.getClient.mockImplementation(() => {
        throw new Error('Redis down');
      });

      const state = await service.checkCooldown('fp3');
      expect(state.suppressed).toBe(false); // fresh in-memory
    });
  });

  // ── recordRaise ────────────────────────────────────────────────────────────

  describe('recordRaise()', () => {
    it('sets cooldown key with correct TTL', async () => {
      await service.recordRaise('fpA');
      expect(mockClient.set).toHaveBeenCalledWith('alert:cooldown:fpA', '1', 'EX', 300);
    });

    it('deletes the suppress counter on fresh raise', async () => {
      await service.recordRaise('fpA');
      expect(mockClient.del).toHaveBeenCalledWith('alert:suppress:fpA');
    });

    it('does not throw when Redis is unavailable', async () => {
      mockClient.set.mockRejectedValue(new Error('Redis down'));
      await expect(service.recordRaise('fpB')).resolves.not.toThrow();
    });
  });

  // ── incrementSuppressedCount ───────────────────────────────────────────────

  describe('incrementSuppressedCount()', () => {
    it('returns the incremented count from Redis', async () => {
      mockClient.incr.mockResolvedValue(3);
      const count = await service.incrementSuppressedCount('fpC');
      expect(count).toBe(3);
    });

    it('extends the TTL on each increment (sliding window)', async () => {
      await service.incrementSuppressedCount('fpD');
      expect(mockClient.expire).toHaveBeenCalledWith('alert:suppress:fpD', 900);
    });

    it('falls back to in-memory counter when Redis fails', async () => {
      mockClient.incr.mockRejectedValue(new Error('Redis down'));
      const count1 = await service.incrementSuppressedCount('fpE');
      const count2 = await service.incrementSuppressedCount('fpE');
      expect(count1).toBe(1);
      expect(count2).toBe(2);
    });
  });

  // ── clearCooldown ──────────────────────────────────────────────────────────

  describe('clearCooldown()', () => {
    it('deletes both Redis keys', async () => {
      await service.clearCooldown('fpF');
      expect(mockClient.del).toHaveBeenCalledWith('alert:cooldown:fpF', 'alert:suppress:fpF');
    });

    it('does not throw when Redis fails', async () => {
      mockClient.del.mockRejectedValue(new Error('Redis down'));
      await expect(service.clearCooldown('fpG')).resolves.not.toThrow();
    });
  });

  // ── Flood scenario ─────────────────────────────────────────────────────────

  describe('flood scenario', () => {
    it('increments suppressed count monotonically across repeated calls', async () => {
      let counter = 0;
      mockClient.incr.mockImplementation(async () => ++counter);

      const fp = 'fpFlood';
      for (let i = 0; i < 5; i++) {
        await service.incrementSuppressedCount(fp);
      }

      expect(counter).toBe(5);
    });
  });
});
