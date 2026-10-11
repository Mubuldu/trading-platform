import { Injectable } from '@nestjs/common';
import { WorkerInfo } from '../identity/worker-identity';
import { ILoadBalancer } from './load-balancer.interface';

/**
 * WeightedBalancer distributes tasks proportionally to the inverse of each
 * worker's current load, giving more work to lighter workers.
 *
 * Weight formula:
 *   weight_i = max(0.01, 1 - (loadScore_i / 100))
 *
 * Where loadScore is the same composite score used by LeastLoadedBalancer.
 * A fully saturated worker (score=100) receives weight 0.01 (not zero) to
 * prevent it from being completely starved while temporarily busy.
 *
 * Selection:
 *   A weighted random sample is drawn by building a cumulative distribution
 *   function (CDF) from the normalized weights and picking via Math.random().
 *   This produces a probabilistic distribution rather than a strict least-
 *   loaded pick, which reduces thundering-herd effects when many tasks arrive
 *   simultaneously (they don't all rush to the same lightly-loaded node).
 *
 * Use weighted balancing when:
 *  - Task duration is highly variable (some tasks finish in 1 ms, others 10 s)
 *  - You want burst absorption (busy workers are down-weighted, not excluded)
 *  - Round-robin's evenness and least-loaded's determinism are both insufficient
 */
@Injectable()
export class WeightedBalancer implements ILoadBalancer {
  readonly strategy = 'weighted';

  private static readonly MAX_TASKS = 50;
  private static readonly MEMORY_REFERENCE_BYTES = 4 * 1024 * 1024 * 1024;
  private static readonly WEIGHT_TASKS = 0.5;
  private static readonly WEIGHT_CPU = 0.3;
  private static readonly WEIGHT_MEMORY = 0.2;
  /** Minimum weight to prevent complete starvation of busy workers. */
  private static readonly MIN_WEIGHT = 0.01;

  select(candidates: WorkerInfo[]): WorkerInfo | null {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const weights = candidates.map((w) => this.weight(w));
    const total = weights.reduce((s, w) => s + w, 0);

    // Weighted random sample
    const rand = Math.random() * total;
    let cumulative = 0;
    for (let i = 0; i < candidates.length; i++) {
      cumulative += weights[i];
      if (rand <= cumulative) {
        return candidates[i];
      }
    }

    // Fallback: return the last candidate (handles floating-point edge cases)
    return candidates[candidates.length - 1];
  }

  private weight(worker: WorkerInfo): number {
    const taskScore = Math.min(1, worker.activeTaskCount / WeightedBalancer.MAX_TASKS) * 100;
    const cpuScore = Math.min(100, worker.cpuPercent);
    const memScore = Math.min(
      100,
      (worker.memoryBytes / WeightedBalancer.MEMORY_REFERENCE_BYTES) * 100,
    );
    const loadScore =
      taskScore * WeightedBalancer.WEIGHT_TASKS +
      cpuScore * WeightedBalancer.WEIGHT_CPU +
      memScore * WeightedBalancer.WEIGHT_MEMORY;
    return Math.max(WeightedBalancer.MIN_WEIGHT, 1 - loadScore / 100);
  }
}
