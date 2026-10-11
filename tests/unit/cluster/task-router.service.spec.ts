import { Test, TestingModule } from '@nestjs/testing';
import { TaskRouterService } from '@infrastructure/cluster/task-distribution/task-router.service';
import { WorkerDiscoveryService } from '@infrastructure/cluster/discovery/worker-discovery.service';
import { RoundRobinBalancer } from '@infrastructure/cluster/task-distribution/round-robin.balancer';
import { LeastLoadedBalancer } from '@infrastructure/cluster/task-distribution/least-loaded.balancer';
import { StickyBalancer } from '@infrastructure/cluster/task-distribution/sticky.balancer';
import { WeightedBalancer } from '@infrastructure/cluster/task-distribution/weighted.balancer';
import { TaskDescriptor, TaskType } from '@infrastructure/cluster/task-distribution/task.types';
import {
  WorkerCapability,
  WorkerInfo,
  WorkerStatus,
} from '@infrastructure/cluster/identity/worker-identity';
import { AppLoggerService } from '@core/logging/app-logger.service';

function makeWorker(nodeId: string, capabilities: WorkerCapability[]): WorkerInfo {
  return {
    nodeId,
    nodeLabel: nodeId,
    hostname: 'host',
    pid: 1234,
    capabilities,
    status: WorkerStatus.ACTIVE,
    startedAt: new Date().toISOString(),
    lastHeartbeatAt: new Date().toISOString(),
    cpuPercent: 10,
    memoryBytes: 256 * 1024 * 1024,
    activeTaskCount: 2,
  };
}

function makeTask(type: TaskType, metadata: Record<string, string> = {}): TaskDescriptor {
  return {
    type,
    metadata,
    payload: { data: 'test' },
    createdAt: new Date().toISOString(),
    correlationId: 'corr-1',
  };
}

describe('TaskRouterService', () => {
  let router: TaskRouterService;
  let discovery: jest.Mocked<WorkerDiscoveryService>;

  beforeEach(async () => {
    const mockLogger = {
      log: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as AppLoggerService;

    discovery = {
      getWorkersByCapability: jest.fn(),
      getActiveWorkers: jest.fn(),
      getWorkerCount: jest.fn(),
      getWorkerCountByCapability: jest.fn(),
      getClusterSummary: jest.fn(),
    } as unknown as jest.Mocked<WorkerDiscoveryService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskRouterService,
        RoundRobinBalancer,
        LeastLoadedBalancer,
        StickyBalancer,
        WeightedBalancer,
        { provide: WorkerDiscoveryService, useValue: discovery },
        { provide: AppLoggerService, useValue: mockLogger },
      ],
    }).compile();

    router = module.get(TaskRouterService);
  });

  describe('route()', () => {
    it('returns Err when no workers available for capability', async () => {
      discovery.getWorkersByCapability.mockResolvedValue([]);
      const result = await router.route(
        makeTask(TaskType.INDICATOR_CANDLE, { symbol: 'BTC/USDT' }),
      );
      expect(result.isErr()).toBe(true);
    });

    it('routes INDICATOR_CANDLE to an indicator worker', async () => {
      const indicatorWorker = makeWorker('ind-1', [WorkerCapability.INDICATOR]);
      discovery.getWorkersByCapability.mockResolvedValue([indicatorWorker]);

      const result = await router.route(
        makeTask(TaskType.INDICATOR_CANDLE, { symbol: 'BTC/USDT' }),
      );

      expect(result.isOk()).toBe(true);
      const decision = result.getOrThrow();
      expect(decision.targetNodeId).toBe('ind-1');
      expect(decision.strategy).toBe('sticky');
    });

    it('routes RISK_EVALUATE with round-robin strategy', async () => {
      const workers = [
        makeWorker('risk-1', [WorkerCapability.RISK]),
        makeWorker('risk-2', [WorkerCapability.RISK]),
      ];
      discovery.getWorkersByCapability.mockResolvedValue(workers);

      const result = await router.route(makeTask(TaskType.RISK_EVALUATE));

      expect(result.isOk()).toBe(true);
      expect(result.getOrThrow().strategy).toBe('round-robin');
    });

    it('routes BACKTEST_RUN with least-loaded strategy', async () => {
      const light = makeWorker('bt-light', [WorkerCapability.BACKTEST]);
      const heavy = {
        ...makeWorker('bt-heavy', [WorkerCapability.BACKTEST]),
        cpuPercent: 90,
        activeTaskCount: 45,
      };
      discovery.getWorkersByCapability.mockResolvedValue([heavy, light]);

      const result = await router.route(makeTask(TaskType.BACKTEST_RUN));

      expect(result.isOk()).toBe(true);
      const decision = result.getOrThrow();
      expect(decision.targetNodeId).toBe('bt-light');
      expect(decision.strategy).toBe('least-loaded');
    });

    it('routes EXECUTION_SUBMIT with sticky by accountId', async () => {
      const workers = [
        makeWorker('exec-1', [WorkerCapability.EXECUTION]),
        makeWorker('exec-2', [WorkerCapability.EXECUTION]),
      ];
      discovery.getWorkersByCapability.mockResolvedValue(workers);

      const task = makeTask(TaskType.EXECUTION_SUBMIT, { accountId: 'acc-123' });
      const r1 = await router.route(task);
      const r2 = await router.route(task);

      expect(r1.isOk()).toBe(true);
      expect(r2.isOk()).toBe(true);
      // Same accountId must go to the same worker every time (sticky)
      expect(r1.getOrThrow().targetNodeId).toBe(r2.getOrThrow().targetNodeId);
    });

    it('different accountIds may route to different workers', async () => {
      const workers = [
        makeWorker('exec-1', [WorkerCapability.EXECUTION]),
        makeWorker('exec-2', [WorkerCapability.EXECUTION]),
        makeWorker('exec-3', [WorkerCapability.EXECUTION]),
      ];
      discovery.getWorkersByCapability.mockResolvedValue(workers);

      const accounts = Array.from({ length: 20 }, (_, i) => `acc-${i}`);
      const targets = await Promise.all(
        accounts.map((a) => router.route(makeTask(TaskType.EXECUTION_SUBMIT, { accountId: a }))),
      );
      const nodeIds = new Set(targets.map((r) => r.getOrThrow().targetNodeId));
      expect(nodeIds.size).toBeGreaterThan(1); // spread across workers
    });
  });

  describe('routeBatch()', () => {
    it('returns a decision for each task', async () => {
      const worker = makeWorker('w1', [WorkerCapability.ANALYTICS]);
      discovery.getWorkersByCapability.mockResolvedValue([worker]);

      const tasks = [makeTask(TaskType.ANALYTICS_COMPUTE), makeTask(TaskType.ANALYTICS_EXPORT)];
      const results = await router.routeBatch(tasks);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.isOk())).toBe(true);
    });

    it('returns Err entries for tasks with no available workers', async () => {
      discovery.getWorkersByCapability.mockResolvedValue([]);
      const tasks = [makeTask(TaskType.ANALYTICS_COMPUTE)];
      const results = await router.routeBatch(tasks);
      expect(results[0].isErr()).toBe(true);
    });
  });
});
