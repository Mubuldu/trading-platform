import { Test, TestingModule } from '@nestjs/testing';
import { WorkerRegistryService } from '@infrastructure/cluster/registry/worker-registry.service';
import { RedisClientService } from '@infrastructure/redis/redis-client.service';
import { AppLoggerService } from '@core/logging/app-logger.service';
import {
  WorkerCapability,
  WorkerInfo,
  WorkerStatus,
  serializeWorkerInfo,
} from '@infrastructure/cluster/identity/worker-identity';

function makeWorker(nodeId: string): WorkerInfo {
  return {
    nodeId,
    nodeLabel: nodeId,
    hostname: 'host',
    pid: 1111,
    capabilities: [WorkerCapability.STRATEGY],
    status: WorkerStatus.ACTIVE,
    startedAt: '2026-01-01T00:00:00.000Z',
    lastHeartbeatAt: '2026-01-01T00:01:00.000Z',
    cpuPercent: 5,
    memoryBytes: 256 * 1024 * 1024,
    activeTaskCount: 0,
  };
}

describe('WorkerRegistryService', () => {
  let service: WorkerRegistryService;

  let mockPipeline: {
    hset: jest.Mock;
    sadd: jest.Mock;
    del: jest.Mock;
    srem: jest.Mock;
    hgetall: jest.Mock;
    exec: jest.Mock;
  };

  let mockRedisClient: {
    pipeline: jest.Mock;
    hgetall: jest.Mock;
    smembers: jest.Mock;
    hset: jest.Mock;
  };

  beforeEach(async () => {
    mockPipeline = {
      hset: jest.fn().mockReturnThis(),
      sadd: jest.fn().mockReturnThis(),
      del: jest.fn().mockReturnThis(),
      srem: jest.fn().mockReturnThis(),
      hgetall: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };

    mockRedisClient = {
      pipeline: jest.fn().mockReturnValue(mockPipeline),
      hgetall: jest.fn(),
      smembers: jest.fn().mockResolvedValue([]),
      hset: jest.fn().mockResolvedValue(0),
    };

    const mockRedisService = {
      getClient: () => mockRedisClient,
    };

    const mockLogger = {
      log: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkerRegistryService,
        { provide: RedisClientService, useValue: mockRedisService },
        { provide: AppLoggerService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get(WorkerRegistryService);
  });

  describe('register()', () => {
    it('pipelines HSET and SADD', async () => {
      const worker = makeWorker('w1');
      await service.register(worker);
      expect(mockPipeline.hset).toHaveBeenCalled();
      expect(mockPipeline.sadd).toHaveBeenCalledWith('cluster:worker-index', 'w1');
      expect(mockPipeline.exec).toHaveBeenCalled();
    });
  });

  describe('deregister()', () => {
    it('pipelines DEL and SREM', async () => {
      await service.deregister('w1');
      expect(mockPipeline.del).toHaveBeenCalledWith('cluster:workers:w1');
      expect(mockPipeline.srem).toHaveBeenCalledWith('cluster:worker-index', 'w1');
      expect(mockPipeline.exec).toHaveBeenCalled();
    });
  });

  describe('getWorker()', () => {
    it('returns null for missing worker', async () => {
      mockRedisClient.hgetall.mockResolvedValue(null);
      expect(await service.getWorker('ghost')).toBeNull();
    });

    it('returns null for empty hash', async () => {
      mockRedisClient.hgetall.mockResolvedValue({});
      expect(await service.getWorker('ghost')).toBeNull();
    });

    it('deserializes worker info correctly', async () => {
      const worker = makeWorker('w2');
      const snap = serializeWorkerInfo(worker);
      mockRedisClient.hgetall.mockResolvedValue(snap);
      const result = await service.getWorker('w2');
      expect(result).not.toBeNull();
      expect(result!.nodeId).toBe('w2');
      expect(result!.capabilities).toContain(WorkerCapability.STRATEGY);
    });
  });

  describe('getAllWorkers()', () => {
    it('returns empty array when index is empty', async () => {
      mockRedisClient.smembers.mockResolvedValue([]);
      expect(await service.getAllWorkers()).toEqual([]);
    });

    it('reads workers via pipeline batch', async () => {
      mockRedisClient.smembers.mockResolvedValue(['w1', 'w2']);
      const snap1 = serializeWorkerInfo(makeWorker('w1'));
      const snap2 = serializeWorkerInfo(makeWorker('w2'));
      mockPipeline.exec.mockResolvedValue([
        [null, snap1],
        [null, snap2],
      ]);
      const workers = await service.getAllWorkers();
      expect(workers).toHaveLength(2);
      expect(workers.map((w) => w.nodeId).sort()).toEqual(['w1', 'w2']);
    });
  });

  describe('getWorkersByCapability()', () => {
    it('filters by capability', async () => {
      const strategyWorker = makeWorker('strat');
      const indicatorWorker: WorkerInfo = {
        ...makeWorker('ind'),
        capabilities: [WorkerCapability.INDICATOR],
      };
      mockRedisClient.smembers.mockResolvedValue(['strat', 'ind']);
      mockPipeline.exec.mockResolvedValue([
        [null, serializeWorkerInfo(strategyWorker)],
        [null, serializeWorkerInfo(indicatorWorker)],
      ]);

      const result = await service.getWorkersByCapability(WorkerCapability.STRATEGY);
      expect(result).toHaveLength(1);
      expect(result[0].nodeId).toBe('strat');
    });
  });

  describe('updateFields()', () => {
    it('calls HSET with the provided fields', async () => {
      await service.updateFields('w1', {
        cpuPercent: '55',
        status: WorkerStatus.DEGRADED,
      });
      expect(mockRedisClient.hset).toHaveBeenCalledWith(
        'cluster:workers:w1',
        'cpuPercent',
        '55',
        'status',
        WorkerStatus.DEGRADED,
      );
    });

    it('does not call HSET when fields is empty', async () => {
      await service.updateFields('w1', {});
      expect(mockRedisClient.hset).not.toHaveBeenCalled();
    });
  });
});
