import { Injectable } from '@nestjs/common';
import { WorkerInfo } from '../identity/worker-identity';
import { ILoadBalancer } from './load-balancer.interface';

/**
 * RoundRobinBalancer cycles through active workers in order, distributing
 * tasks evenly regardless of current load.
 *
 * State:
 *  A Map keyed by capability string tracks the current cursor position per
 *  capability pool. The cursor advances by 1 modulo the pool size on each
 *  call. Using a Map (vs a single integer) ensures that indicator, strategy,
 *  analytics, and risk pools each maintain their own independent rotation.
 *
 * Thread safety:
 *  Node.js is single-threaded so there are no concurrent writes to the cursor
 *  map. If this service were ever moved to a worker thread, the cursor update
 *  would need a lock.
 *
 * Fairness:
 *  Round-robin guarantees that over N calls, each worker receives exactly 1
 *  task if pool size is N. It does NOT account for worker load — use
 *  LeastLoadedBalancer when tasks have highly variable processing time.
 */
@Injectable()
export class RoundRobinBalancer implements ILoadBalancer {
  readonly strategy = 'round-robin';

  /**
   * Cursors keyed by a canonical representation of the candidate set.
   * Using the sorted nodeId list as a key means the cursor resets when
   * the pool membership changes (workers join or leave).
   */
  private readonly cursors = new Map<string, number>();

  select(candidates: WorkerInfo[]): WorkerInfo | null {
    if (candidates.length === 0) return null;

    const poolKey = this.poolKey(candidates);
    const current = this.cursors.get(poolKey) ?? 0;
    const index = current % candidates.length;
    this.cursors.set(poolKey, index + 1);

    return candidates[index];
  }

  private poolKey(candidates: WorkerInfo[]): string {
    // Sort to produce a stable key regardless of discovery order
    return candidates
      .map((w) => w.nodeId)
      .sort()
      .join(',');
  }
}
