import { PgDatabaseManager } from '@infrastructure/database/connection/pg-database-manager.service';
import { PgPoolService } from '@infrastructure/database/connection/pg-pool.service';

describe('PgDatabaseManager', () => {
  let manager: PgDatabaseManager;
  let poolService: jest.Mocked<PgPoolService>;
  let mockClient: { query: jest.Mock; release: jest.Mock };

  beforeEach(() => {
    mockClient = { query: jest.fn(), release: jest.fn() };
    poolService = {
      rawPool: {
        connect: jest.fn().mockResolvedValue(mockClient),
        totalCount: 2,
        idleCount: 2,
        waitingCount: 0,
      },
      db: {} as never,
    } as unknown as jest.Mocked<PgPoolService>;

    manager = new PgDatabaseManager(poolService);
  });

  describe('ping()', () => {
    it('returns ok when SELECT 1 succeeds', async () => {
      mockClient.query.mockResolvedValueOnce({});

      const result = await manager.ping();

      expect(result.isOk()).toBe(true);
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('returns DatabaseError when connection fails', async () => {
      (poolService.rawPool.connect as jest.Mock).mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await manager.ping();

      expect(result.isErr()).toBe(true);
      expect(result.isErr() && result.error.message).toContain('PostgreSQL ping failed');
    });
  });

  describe('connect()', () => {
    it('sets connected=true on success', async () => {
      mockClient.query.mockResolvedValueOnce({});

      await manager.connect();

      expect(manager.isConnected()).toBe(true);
    });

    it('does not set connected=true on ping failure', async () => {
      (poolService.rawPool.connect as jest.Mock).mockRejectedValueOnce(new Error('timeout'));

      await manager.connect();

      expect(manager.isConnected()).toBe(false);
    });
  });

  describe('disconnect()', () => {
    it('sets connected=false', async () => {
      mockClient.query.mockResolvedValueOnce({});
      await manager.connect();

      await manager.disconnect();

      expect(manager.isConnected()).toBe(false);
    });
  });

  describe('getHealth()', () => {
    it('returns healthy with pool metrics when ping succeeds', async () => {
      mockClient.query.mockResolvedValueOnce({});

      const health = await manager.getHealth();

      expect(health.status).toBe('healthy');
      expect(health.message).toContain('pool');
    });

    it('returns unhealthy when ping fails', async () => {
      (poolService.rawPool.connect as jest.Mock).mockRejectedValueOnce(
        new Error('connection refused'),
      );

      const health = await manager.getHealth();

      expect(health.status).toBe('unhealthy');
    });
  });

  describe('getProviderName()', () => {
    it('returns postgresql', () => {
      expect(manager.getProviderName()).toBe('postgresql');
    });
  });
});
