import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LeaderElectionService } from '@infrastructure/cluster/leader/leader-election.service';
import { LEADER_ELECTION_EVENTS } from '@infrastructure/cluster/leader/leader-election.events';
import { WorkerIdService } from '@infrastructure/cluster/identity/worker-id.service';
import { HeartbeatService } from '@infrastructure/cluster/heartbeat/heartbeat.service';
import { RedisClientService } from '@infrastructure/redis/redis-client.service';
import { AppLoggerService } from '@core/logging/app-logger.service';

describe('LeaderElectionService', () => {
  let service: LeaderElectionService;
  let mockRedisClient: { set: jest.Mock; eval: jest.Mock; get: jest.Mock };
  let mockWorkerIdService: { nodeId: string };
  let mockHeartbeat: { startDeadWorkerScanner: jest.Mock; stopDeadWorkerScanner: jest.Mock };

  beforeEach(async () => {
    mockRedisClient = {
      set: jest.fn(),
      eval: jest.fn(),
      get: jest.fn(),
    };

    mockWorkerIdService = { nodeId: 'test-node-1' };

    mockHeartbeat = {
      startDeadWorkerScanner: jest.fn(),
      stopDeadWorkerScanner: jest.fn(),
    };

    const mockRedisService = {
      getClient: () => mockRedisClient,
    };

    const mockConfigService = {
      get: jest.fn().mockReturnValue({
        leaderLeaseTtlMs: 30_000,
        leaderRenewalIntervalMs: 10_000,
      }),
    };

    const mockLogger = {
      log: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaderElectionService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: RedisClientService, useValue: mockRedisService },
        { provide: WorkerIdService, useValue: mockWorkerIdService },
        { provide: HeartbeatService, useValue: mockHeartbeat },
        { provide: AppLoggerService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get(LeaderElectionService);
  });

  afterEach(async () => {
    // Stop any running timers
    await service.onModuleDestroy();
  });

  describe('isLeader', () => {
    it('is false before election attempt', () => {
      expect(service.isLeader).toBe(false);
    });
  });

  describe('getCurrentLeader()', () => {
    it('returns the leader nodeId from Redis', async () => {
      mockRedisClient.get.mockResolvedValue('other-node');
      expect(await service.getCurrentLeader()).toBe('other-node');
    });

    it('returns null when no leader is elected', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      expect(await service.getCurrentLeader()).toBeNull();
    });
  });

  describe('leadership acquisition', () => {
    it('emits GAINED and sets isLeader when SET NX succeeds', async () => {
      mockRedisClient.set.mockResolvedValue('OK');
      // Prevent renewal loop from firing by mocking eval
      mockRedisClient.eval.mockResolvedValue(1);

      const gained = new Promise<void>((resolve) => {
        service.on(LEADER_ELECTION_EVENTS.GAINED, () => resolve());
      });

      service.start();
      await gained;

      expect(service.isLeader).toBe(true);
      expect(mockHeartbeat.startDeadWorkerScanner).toHaveBeenCalledTimes(1);
    });

    it('does not gain leadership when SET NX fails (another leader exists)', async () => {
      mockRedisClient.set.mockResolvedValue(null); // NX fails → key exists

      let gained = false;
      service.on(LEADER_ELECTION_EVENTS.GAINED, () => {
        gained = true;
      });

      // Trigger one election attempt manually via start() + immediate tick
      // Without awaiting the interval we just check the direct SET result
      mockRedisClient.set.mockResolvedValue(null);

      // Invoke internal election manually
      // Access private method via any cast for testing
      await (service as unknown as { attemptElection: () => Promise<void> })['attemptElection']?.();

      expect(gained).toBe(false);
      expect(service.isLeader).toBe(false);
    });
  });

  describe('leadership loss on renewal failure', () => {
    it('emits LOST when renewal Lua script returns 0 (key hijacked)', async () => {
      // Gain leadership first (SET NX returns OK, no eval needed at this stage).
      mockRedisClient.set.mockResolvedValue('OK');
      // Renewal timer interval is 10 000 ms — it will NOT fire during this test.
      // eval is therefore only called by the explicit renewLeadership() call below.
      mockRedisClient.eval.mockResolvedValue(0); // renewal fails → key hijacked

      const gainedPromise = new Promise<void>((resolve) => {
        service.on(LEADER_ELECTION_EVENTS.GAINED, () => resolve());
      });
      service.start();
      await gainedPromise;

      const lostPromise = new Promise<void>((resolve) => {
        service.on(LEADER_ELECTION_EVENTS.LOST, () => resolve());
      });

      // Trigger renewal manually to simulate the interval firing.
      await (service as unknown as { renewLeadership: () => Promise<void> })['renewLeadership']?.();

      await lostPromise;
      expect(service.isLeader).toBe(false);
      expect(mockHeartbeat.stopDeadWorkerScanner).toHaveBeenCalledTimes(1);
    });
  });
});
