import { StickyBalancer } from '@infrastructure/cluster/task-distribution/sticky.balancer';
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
    capabilities: [WorkerCapability.INDICATOR],
    status: WorkerStatus.ACTIVE,
    startedAt: new Date().toISOString(),
    lastHeartbeatAt: new Date().toISOString(),
    cpuPercent: 10,
    memoryBytes: 256 * 1024 * 1024,
    activeTaskCount: 0,
  };
}

describe('StickyBalancer', () => {
  let balancer: StickyBalancer;
  const workers = ['w1', 'w2', 'w3', 'w4', 'w5'].map(makeWorker);

  beforeEach(() => {
    balancer = new StickyBalancer();
  });

  it('returns null for empty candidates', () => {
    expect(balancer.select([], 'BTC/USDT')).toBeNull();
  });

  it('returns single worker for single candidate', () => {
    const w = makeWorker('only');
    expect(balancer.select([w], 'BTC/USDT')).toBe(w);
  });

  it('maps the same symbol consistently to the same worker', () => {
    const symbol = 'BTC/USDT';
    const first = balancer.select(workers, symbol);
    expect(balancer.select(workers, symbol)).toBe(first);
    expect(balancer.select(workers, symbol)).toBe(first);
  });

  it('maps different symbols to potentially different workers', () => {
    const symbols = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'DOGE/USDT'];
    const selected = symbols.map((s) => balancer.select(workers, s)!.nodeId);
    const unique = new Set(selected);
    // With 5 symbols and 5 workers, rendezvous hashing should spread them
    expect(unique.size).toBeGreaterThan(1);
  });

  it('distributes 1000 symbols across workers (no extreme imbalance)', () => {
    const tallies: Record<string, number> = {};
    for (let i = 0; i < 1000; i++) {
      const symbol = `TOKEN${i}/USDT`;
      const selected = balancer.select(workers, symbol)!;
      tallies[selected.nodeId] = (tallies[selected.nodeId] ?? 0) + 1;
    }

    const counts = Object.values(tallies);
    expect(counts).toHaveLength(5); // all 5 workers get some traffic
    const max = Math.max(...counts);
    const min = Math.min(...counts);
    // Rendezvous hashing should not produce more than 3× imbalance for 1000 symbols
    expect(max / min).toBeLessThan(3);
  });

  it('reassigns minimally when a worker is removed', () => {
    const symbols = Array.from({ length: 100 }, (_, i) => `SYM${i}/USDT`);

    // Map before worker removal
    const before = new Map(symbols.map((s) => [s, balancer.select(workers, s)!.nodeId]));

    // Remove w5
    const reducedWorkers = workers.slice(0, 4);
    let remapped = 0;
    for (const sym of symbols) {
      const after = balancer.select(reducedWorkers, sym)!.nodeId;
      if (before.get(sym) !== after) remapped++;
    }

    // Rendezvous hashing: removing 1 of 5 workers should remap ~1/5 = 20 symbols
    // Allow generous tolerance (10–40)
    expect(remapped).toBeGreaterThanOrEqual(5);
    expect(remapped).toBeLessThanOrEqual(50);
  });

  it('falls back to sorted nodeId when no stickyValue is given', () => {
    const selected = balancer.select(workers, undefined);
    expect(selected).not.toBeNull();
    // Should deterministically pick the worker with the smallest nodeId
    const sortedFirst = [...workers].sort((a, b) => a.nodeId.localeCompare(b.nodeId))[0];
    expect(selected!.nodeId).toBe(sortedFirst.nodeId);
  });

  it('has strategy name', () => {
    expect(balancer.strategy).toBe('sticky');
  });
});
