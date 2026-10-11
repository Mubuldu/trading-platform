import { LeastLoadedBalancer } from '@infrastructure/cluster/task-distribution/least-loaded.balancer';
import {
  WorkerInfo,
  WorkerCapability,
  WorkerStatus,
} from '@infrastructure/cluster/identity/worker-identity';

function makeWorker(
  nodeId: string,
  overrides: Partial<Pick<WorkerInfo, 'cpuPercent' | 'memoryBytes' | 'activeTaskCount'>> = {},
): WorkerInfo {
  return {
    nodeId,
    nodeLabel: nodeId,
    hostname: 'host',
    pid: 1234,
    capabilities: [WorkerCapability.BACKTEST],
    status: WorkerStatus.ACTIVE,
    startedAt: new Date().toISOString(),
    lastHeartbeatAt: new Date().toISOString(),
    cpuPercent: overrides.cpuPercent ?? 0,
    memoryBytes: overrides.memoryBytes ?? 512 * 1024 * 1024,
    activeTaskCount: overrides.activeTaskCount ?? 0,
  };
}

describe('LeastLoadedBalancer', () => {
  let balancer: LeastLoadedBalancer;

  beforeEach(() => {
    balancer = new LeastLoadedBalancer();
  });

  it('returns null for empty candidates', () => {
    expect(balancer.select([])).toBeNull();
  });

  it('returns the only worker for single candidate', () => {
    const w = makeWorker('w1', { cpuPercent: 90 });
    expect(balancer.select([w])).toBe(w);
  });

  it('selects the worker with zero load over a busy one', () => {
    const idle = makeWorker('idle', { cpuPercent: 0, activeTaskCount: 0 });
    const busy = makeWorker('busy', { cpuPercent: 80, activeTaskCount: 20 });
    expect(balancer.select([idle, busy])).toBe(idle);
    expect(balancer.select([busy, idle])).toBe(idle); // order-independent
  });

  it('selects the least-loaded worker from three candidates', () => {
    const heavy = makeWorker('heavy', { cpuPercent: 90, activeTaskCount: 40 });
    const medium = makeWorker('medium', { cpuPercent: 50, activeTaskCount: 10 });
    const light = makeWorker('light', { cpuPercent: 5, activeTaskCount: 1 });
    expect(balancer.select([heavy, medium, light])).toBe(light);
  });

  it('breaks ties deterministically by nodeId', () => {
    // Both workers have identical load — nodeId 'aaa' < 'zzz'
    const a = makeWorker('aaa', { cpuPercent: 10, activeTaskCount: 2 });
    const z = makeWorker('zzz', { cpuPercent: 10, activeTaskCount: 2 });
    expect(balancer.select([z, a])).toBe(a);
    expect(balancer.select([a, z])).toBe(a);
  });

  it('normalizes activeTaskCount correctly at max', () => {
    // Worker with max tasks (50) should have full task component
    const full = makeWorker('full', { activeTaskCount: 50, cpuPercent: 0 });
    const empty = makeWorker('empty', { activeTaskCount: 0, cpuPercent: 0 });
    expect(balancer.select([full, empty])).toBe(empty);
  });

  it('has strategy name', () => {
    expect(balancer.strategy).toBe('least-loaded');
  });
});
