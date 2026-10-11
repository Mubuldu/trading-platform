import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { ok, err } from '@common/result';
import type { Result } from '@common/result';
import { ServiceUnavailableError } from '@common/errors/infrastructure.error';
import { InfrastructureError } from '@common/errors/infrastructure.error';
import { WorkerCapability } from '../identity/worker-identity';
import { WorkerDiscoveryService } from '../discovery/worker-discovery.service';
import { RoundRobinBalancer } from './round-robin.balancer';
import { LeastLoadedBalancer } from './least-loaded.balancer';
import { StickyBalancer } from './sticky.balancer';
import { WeightedBalancer } from './weighted.balancer';
import { TaskDescriptor, RoutingDecision, TASK_TYPE_CONFIG, TaskTypeConfig } from './task.types';
import { ILoadBalancer } from './load-balancer.interface';

/**
 * TaskRouterService resolves which worker should handle a given task and
 * returns a RoutingDecision that the caller uses to enqueue the work.
 *
 * Flow:
 *   1. Look up the TaskTypeConfig for the task's type
 *   2. Query WorkerDiscoveryService for active workers with that capability
 *   3. Select a worker using the configured ILoadBalancer
 *   4. Return RoutingDecision with the target nodeId
 *
 * The router does NOT enqueue the task — it only decides where it should go.
 * Separation of concern: routing decisions are synchronous and testable;
 * enqueuing involves I/O and belongs to the caller.
 *
 * Error cases:
 *   - No workers with required capability → ServiceUnavailableError (retryable)
 *   - Balancer returns null (internal) → ServiceUnavailableError
 *
 * Single-node behaviour (cluster.enabled=false):
 *   WorkerDiscoveryService returns the local worker as the sole candidate.
 *   All strategies degenerate to "select the only worker" — correct behaviour.
 */
@Injectable()
export class TaskRouterService {
  private readonly context = TaskRouterService.name;

  /** Strategy registry: maps strategy name to its balancer instance. */
  private readonly balancers: Map<string, ILoadBalancer>;

  constructor(
    private readonly discovery: WorkerDiscoveryService,
    private readonly roundRobin: RoundRobinBalancer,
    private readonly leastLoaded: LeastLoadedBalancer,
    private readonly sticky: StickyBalancer,
    private readonly weighted: WeightedBalancer,
    private readonly logger: AppLoggerService,
  ) {
    this.balancers = new Map<string, ILoadBalancer>([
      ['round-robin', this.roundRobin],
      ['least-loaded', this.leastLoaded],
      ['sticky', this.sticky],
      ['weighted', this.weighted],
    ]);
  }

  /**
   * Route a task and return the decision (which worker should handle it).
   *
   * Returns Err when no capable, active workers are found. The caller should
   * treat this as a retryable transient error and re-enqueue after a backoff.
   */
  async route(task: TaskDescriptor): Promise<Result<RoutingDecision, InfrastructureError>> {
    const typeConfig: TaskTypeConfig | undefined = TASK_TYPE_CONFIG[task.type];
    if (!typeConfig) {
      return err(
        new ServiceUnavailableError(`Unknown task type "${task.type}" — no routing config found`),
      );
    }

    const candidates = await this.discovery.getWorkersByCapability(
      typeConfig.capability as WorkerCapability,
    );

    if (candidates.length === 0) {
      this.logger.warn(
        `No active workers for capability=${typeConfig.capability}, taskType=${task.type}`,
        this.context,
      );
      return err(
        new ServiceUnavailableError(
          `No active workers available for capability "${typeConfig.capability}"`,
        ),
      );
    }

    const balancer = this.balancers.get(typeConfig.strategy) ?? this.roundRobin;

    const stickyValue =
      typeConfig.strategy === 'sticky' && typeConfig.stickyKey
        ? task.metadata[typeConfig.stickyKey]
        : undefined;

    const selected = balancer.select(candidates, stickyValue);

    if (!selected) {
      return err(
        new ServiceUnavailableError(
          `Load balancer "${typeConfig.strategy}" could not select a worker`,
        ),
      );
    }

    const decision: RoutingDecision = {
      targetNodeId: selected.nodeId,
      taskType: task.type,
      strategy: typeConfig.strategy,
    };

    this.logger.debug(
      `Routed taskType=${task.type} → nodeId=${selected.nodeId} ` +
        `(strategy=${typeConfig.strategy}, candidates=${candidates.length})`,
      this.context,
    );

    return ok(decision);
  }

  /**
   * Return routing decisions for a batch of tasks in one call.
   * Used by backtest runners that dispatch thousands of tasks at startup.
   */
  async routeBatch(
    tasks: TaskDescriptor[],
  ): Promise<Result<RoutingDecision, InfrastructureError>[]> {
    return Promise.all(tasks.map((t) => this.route(t)));
  }
}
