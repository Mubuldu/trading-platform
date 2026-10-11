import { RoundRobinBalancer } from '@infrastructure/cluster/task-distribution/round-robin.balancer';
import {
  WorkerInfo,
  WorkerCapability,
  WorkerStatus,
} from '@infrastructure/cluster/identity/worker-identity';

function makeWorker(nodeId: string): WorkerInfo {
  return {
    nodeId,
    nodeLabel: nodeId,
    hostname: 'host',
    pid: 1234,
    capabilities: [WorkerCapability.STRATEGY],
    status: WorkerStatus.ACTIVE,
    startedAt: new Date().toISOString(),
    lastHeartbeatAt: new Date().toISOString(),
    cpuPercent: 10,
    memoryBytes: 256 * 1024 * 1024,
    activeTaskCount: 0,
  };
}

describe('RoundRobinBalancer', () => {
  let balancer: RoundRobinBalancer;

  beforeEach(() => {
    balancer = new RoundRobinBalancer();
  });

  it('returns null for empty candidates', () => {
    expect(balancer.select([])).toBeNull();
  });

  it('returns the only worker for single-element pool', () => {
    const w = makeWorker('w1');
    expect(balancer.select([w])).toBe(w);
    expect(balancer.select([w])).toBe(w); // consistent
  });

  it('cycles through workers in order', () => {
    const w1 = makeWorker('w1');
    const w2 = makeWorker('w2');
    const w3 = makeWorker('w3');
    const candidates = [w1, w2, w3];

    const results = [
      balancer.select(candidates),
      balancer.select(candidates),
      balancer.select(candidates),
      balancer.select(candidates), // wraps around
    ];

    // Each worker gets exactly one turn, then repeats
    expect(results[0]).toBe(results[3]); // round-trip
    const unique = new Set(results.slice(0, 3).map((w) => w!.nodeId));
    expect(unique.size).toBe(3); // all three seen
  });

  it('resets cursor when pool membership changes', () => {
    const w1 = makeWorker('w1');
    const w2 = makeWorker('w2');
    balancer.select([w1, w2]);
    balancer.select([w1, w2]);

    // New pool (w3 added) — cursor should reset (different poolKey)
    const w3 = makeWorker('w3');
    const selected = balancer.select([w1, w2, w3]);
    expect(selected).not.toBeNull();
    // Just verify no crash and a valid worker is returned
    expect([w1.nodeId, w2.nodeId, w3.nodeId]).toContain(selected!.nodeId);
  });

  it('distributes evenly over N calls with N workers', () => {
    const workers = ['a', 'b', 'c', 'd', 'e'].map(makeWorker);
    const tallies: Record<string, number> = {};
    const N = 100;

    for (let i = 0; i < N; i++) {
      const selected = balancer.select(workers)!;
      tallies[selected.nodeId] = (tallies[selected.nodeId] ?? 0) + 1;
    }

    // Each worker should get exactly N/5 = 20 tasks
    for (const count of Object.values(tallies)) {
      expect(count).toBe(20);
    }
  });

  it('has strategy name', () => {
    expect(balancer.strategy).toBe('round-robin');
  });
});
