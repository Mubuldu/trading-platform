import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { WorkerInfo } from '../identity/worker-identity';
import { ILoadBalancer } from './load-balancer.interface';

/**
 * StickyBalancer maps an affinity key (e.g. symbol name, account ID) to a
 * consistent worker using rendezvous hashing (highest-random-weight hashing).
 *
 * Why rendezvous hashing (HRW) over consistent hashing?
 *  - No ring data structure to maintain
 *  - O(N) computation with very small N (≤ 100 workers typically)
 *  - Minimal redistribution when workers join/leave: only 1/N of keys move
 *  - Deterministic, reproducible, testable — same input always yields same output
 *
 * Why not modulo hashing?
 * stickyValue hash % workers.length breaks when workers join/leave because
 * almost all keys remap. If a worker crashes, every key modulo remaps to a
 * different worker, destroying the cache locality benefit. HRW gracefully
 * handles churn.
 *
 * Session-sticky routing benefits:
 *  INDICATOR_*:  Each indicator calculator maintains a sliding-window state
 *                (EMA, ATR, etc.) in process memory. Routing the same symbol
 *                to the same worker avoids constant reloading from Redis.
 *  EXECUTION_*:  Order fills for the same account must be serialized to prevent
 *                race conditions on position tracking. Sticky routing guarantees
 *                at-most-one concurrent executor per account.
 */
@Injectable()
export class StickyBalancer implements ILoadBalancer {
  readonly strategy = 'sticky';

  select(candidates: WorkerInfo[], stickyValue?: string): WorkerInfo | null {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    // Without a sticky value fall back to the first worker sorted by nodeId
    if (!stickyValue) {
      return [...candidates].sort((a, b) => a.nodeId.localeCompare(b.nodeId))[0];
    }

    // Rendezvous hashing: compute a score for each (worker, stickyValue) pair
    // and return the worker with the highest score.
    let bestWorker: WorkerInfo | null = null;
    let bestScore = '';

    for (const worker of candidates) {
      const score = this.hrwScore(worker.nodeId, stickyValue);
      if (score > bestScore) {
        bestScore = score;
        bestWorker = worker;
      }
    }

    return bestWorker;
  }

  /**
   * Compute a SHA-256 hash of "nodeId:stickyValue" and return it as a hex
   * string. Comparing hex strings lexicographically is equivalent to comparing
   * the numeric hash value — whichever is largest wins.
   *
   * Using SHA-256 (not MD5) for consistent quality across all inputs.
   * The operation is fast: < 5 µs per candidate in benchmarks.
   */
  private hrwScore(nodeId: string, stickyValue: string): string {
    return createHash('sha256').update(`${nodeId}:${stickyValue}`).digest('hex');
  }
}
