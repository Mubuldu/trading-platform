import { DatabaseHealthService } from '@infrastructure/database/health/database-health.service';
import { PgPoolService } from '@infrastructure/database/connection/pg-pool.service';
import { AppLoggerService } from '@core/logging/app-logger.service';

describe('DatabaseHealthService', () => {
  let service: DatabaseHealthService;
  let poolService: jest.Mocked<PgPoolService>;
  let logger: jest.Mocked<AppLoggerService>;
  let mockClient: { query: jest.Mock; release: jest.Mock };

  beforeEach(() => {
    mockClient = { query: jest.fn().mockResolvedValue({}), release: jest.fn() };

    poolService = {
      rawPool: {
        connect: jest.fn().mockResolvedValue(mockClient),
        totalCount: 5,
        idleCount: 3,
        waitingCount: 0,
      },
    } as unknown as jest.Mocked<PgPoolService>;

    logger = {
      error: jest.fn(),
    } as unknown as jest.Mocked<AppLoggerService>;

    service = new DatabaseHealthService(poolService, logger);
  });

  describe('getHealth()', () => {
    it('returns healthy status when ping succeeds', async () => {
      const health = await service.getHealth();

      expect(health.status).toBe('healthy');
      expect(health.message).toContain('RTT');
    });

    it('returns unhealthy when connection fails', async () => {
      (poolService.rawPool.connect as jest.Mock).mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const health = await service.getHealth();

      expect(health.status).toBe('unhealthy');
      expect(health.message).toContain('ECONNREFUSED');
      expect(logger.error).toHaveBeenCalled();
    });

    it('returns unhealthy on slow response (>1000ms)', async () => {
      jest.useFakeTimers();
      mockClient.query.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 1500)),
      );

      const healthPromise = service.getHealth();
      // Drain the microtask queue so the Promise internals register the setTimeout
      await Promise.resolve();
      jest.advanceTimersByTime(1500);
      const health = await healthPromise;

      expect(health.status).toBe('unhealthy');
      jest.useRealTimers();
    });

    it('includes pool metrics in healthy message', async () => {
      const health = await service.getHealth();

      expect(health.message).toContain('pool');
    });
  });

  describe('metrics()', () => {
    it('returns pool connection counts', async () => {
      const metrics = await service.metrics();

      expect(metrics.totalConnections).toBe(5);
      expect(metrics.idleConnections).toBe(3);
      expect(metrics.waitingClients).toBe(0);
      expect(typeof metrics.roundTripMs).toBe('number');
    });
  });
});
