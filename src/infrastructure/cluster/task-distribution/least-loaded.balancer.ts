import { Injectable } from '@nestjs/common';
import { WorkerInfo } from '../identity/worker-identity';
import { ILoadBalancer } from './load-balancer.interface';

/**
 * LeastLoadedBalancer selects the worker with the lowest composite load score.
 *
 * Load score formula:
 *   score = (activeTaskCount × 0.5) + (cpuPercent × 0.3) + (memoryScore × 0.2)
 *
 * Where memoryScore is normalized to 0–100 using a 4 GB reference maximum.
 * The weights are tunable but the defaults reflect a typical trading workload
 * where task queue depth is the primary bottleneck, CPU is secondary, and
 * memory pressure rarely differentiates among healthy workers.
 *
 * Tie-breaking:
 * When two workers have equal scores, the one with the lower sorted nodeId
 * is chosen. This deterministic tie-break prevents random oscillation in
 * steady state and makes routing decisions reproducible in tests.
 *
 * This balancer is recommended for CPU-intensive tasks (backtest runs,
 * Monte Carlo simulations) where the right choice is materially different
 * from a random or round-robin pick.
 */
@Injectable()
export class LeastLoadedBalancer implements ILoadBalancer {
  readonly strategy = 'least-loaded';

  /** Reference maximum memory (bytes) for normalizing memoryScore to 0–100. */
  private static readonly MEMORY_REFERENCE_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB

  private static readonly WEIGHT_TASKS = 0.5;
  private static readonly WEIGHT_CPU = 0.3;
  private static readonly WEIGHT_MEMORY = 0.2;

  /** Maximum assumed concurrent tasks per worker for normalization. */
  private static readonly MAX_TASKS = 50;

  select(candidates: WorkerInfo[]): WorkerInfo | null {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    let bestWorker: WorkerInfo | null = null;
    let bestScore = Infinity;

    for (const worker of candidates) {
      const score = this.loadScore(worker);
      if (score < bestScore || (score === bestScore && this.tieBreak(worker, bestWorker!))) {
        bestScore = score;
        bestWorker = worker;
      }
    }

    return bestWorker;
  }

  private loadScore(worker: WorkerInfo): number {
    const taskScore = Math.min(1, worker.activeTaskCount / LeastLoadedBalancer.MAX_TASKS) * 100;
    const cpuScore = Math.min(100, worker.cpuPercent);
    const memScore = Math.min(
      100,
      (worker.memoryBytes / LeastLoadedBalancer.MEMORY_REFERENCE_BYTES) * 100,
    );

    return (
      taskScore * LeastLoadedBalancer.WEIGHT_TASKS +
      cpuScore * LeastLoadedBalancer.WEIGHT_CPU +
      memScore * LeastLoadedBalancer.WEIGHT_MEMORY
    );
  }

  private tieBreak(challenger: WorkerInfo, current: WorkerInfo): boolean {
    return challenger.nodeId < current.nodeId;
  }
}
