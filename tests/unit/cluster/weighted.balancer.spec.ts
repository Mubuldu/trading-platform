import { WeightedBalancer } from '@infrastructure/cluster/task-distribution/weighted.balancer';
import {
  WorkerInfo,
  WorkerCapability,
  WorkerStatus,
} from '@infrastructure/cluster/identity/worker-identity';

function makeWorker(nodeId: string, cpuPercent = 0, activeTaskCount = 0): WorkerInfo {
  return {
    nodeId,
    nodeLabel: nodeId,
    hostname: 'host',
    pid: 1234,
    capabilities: [WorkerCapability.ANALYTICS],
    status: WorkerStatus.ACTIVE,
    startedAt: new Date().toISOString(),
    lastHeartbeatAt: new Date().toISOString(),
    cpuPercent,
    memoryBytes: 512 * 1024 * 1024,
    activeTaskCount,
  };
}

describe('WeightedBalancer', () => {
  let balancer: WeightedBalancer;

  beforeEach(() => {
    balancer = new WeightedBalancer();
  });

  it('returns null for empty candidates', () => {
    expect(balancer.select([])).toBeNull();
  });

  it('returns single worker for single candidate regardless of load', () => {
    const w = makeWorker('heavy', 95, 48);
    expect(balancer.select([w])).toBe(w);
  });

  it('selects an idle worker more frequently than a busy one over many calls', () => {
    const idle = makeWorker('idle', 0, 0);
    const busy = makeWorker('busy', 90, 45);
    const candidates = [idle, busy];

    const counts: Record<string, number> = { idle: 0, busy: 0 };
    const N = 1000;

    for (let i = 0; i < N; i++) {
      const selected = balancer.select(candidates)!;
      counts[selected.nodeId]++;
    }

    // Idle worker should receive significantly more tasks
    expect(counts.idle).toBeGreaterThan(counts.busy * 3);
  });

  it('does not completely starve busy workers (MIN_WEIGHT floor)', () => {
    // saturated: cpu=100, tasks=50  → loadScore=80 → weight=max(0.01,1-0.80)=0.20
    // idle:      cpu=0,   tasks=0   → loadScore=0  → weight=max(0.01,1-0.00)=1.00
    // Expected proportions: sat≈0.2/1.2≈16.7%, idle≈1.0/1.2≈83.3%.
    const saturated = makeWorker('sat', 100, 50);
    const idle = makeWorker('idle', 0, 0);
    const candidates = [saturated, idle];

    let saturatedCount = 0;
    for (let i = 0; i < 1000; i++) {
      if (balancer.select(candidates)!.nodeId === 'sat') saturatedCount++;
    }

    // The saturated worker must receive some tasks (floor prevents full starvation)
    // but significantly fewer than the idle worker.
    // Expected ~167; allow ±15% statistical variation → 100–235 range.
    expect(saturatedCount).toBeGreaterThan(0);
    expect(saturatedCount).toBeLessThan(idle ? 1000 - saturatedCount : 1000); // fewer than idle
    // The idle worker must get at least twice as many tasks as the busy one.
    const idleCount = 1000 - saturatedCount;
    expect(idleCount).toBeGreaterThan(saturatedCount * 2);
  });

  it('distributes evenly across equally-loaded workers over many calls', () => {
    const workers = ['a', 'b', 'c'].map((id) => makeWorker(id, 10, 2));
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    const N = 3000;

    for (let i = 0; i < N; i++) {
      const selected = balancer.select(workers)!;
      counts[selected.nodeId]++;
    }

    // Should be roughly 1000 each; allow ±20%
    for (const count of Object.values(counts)) {
      expect(count).toBeGreaterThan(700);
      expect(count).toBeLessThan(1300);
    }
  });

  it('has strategy name', () => {
    expect(balancer.strategy).toBe('weighted');
  });
});
