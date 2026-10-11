import { WorkerInfo } from '../identity/worker-identity';

/**
 * ILoadBalancer is the selection interface that all balancers implement.
 *
 * Each implementation receives the full list of ACTIVE workers with the
 * required capability and returns one. Returning null means no suitable
 * worker was found (empty list or all workers are saturated).
 *
 * Balancers are stateless services (no persistent state between calls)
 * to keep the routing decision pure and testable. The one exception is
 * RoundRobinBalancer, which maintains a counter per capability that
 * advances on each call.
 */
export interface ILoadBalancer {
  /** Human-readable strategy name for logging and metrics. */
  readonly strategy: string;

  /**
   * Select one worker from the candidates.
   *
   * @param candidates  Active workers with the required capability.
   *                    Guaranteed non-empty by the TaskRouter (it rejects early
   *                    if no workers are available).
   * @param stickyValue For sticky balancers: the affinity key value (e.g. the
   *                    symbol string). Ignored by non-sticky balancers.
   * @returns The selected worker, or null if the balancer cannot decide.
   */
  select(candidates: WorkerInfo[], stickyValue?: string): WorkerInfo | null;
}
