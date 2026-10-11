import { WorkerCapability } from '../identity/worker-identity';

/**
 * TaskType identifies the class of work being routed.
 *
 * The task router maps each TaskType to:
 *  1. A required WorkerCapability (which workers can handle it)
 *  2. A load-balancing strategy (how to pick among capable workers)
 *  3. An optional sticky key (used by the sticky balancer)
 *
 * Rules for adding a new TaskType:
 *  - Add an enum value here
 *  - Add a TaskTypeConfig entry in TASK_TYPE_CONFIG below
 *  - The task router picks the strategy and capability automatically
 */
export enum TaskType {
  // Indicator engine tasks — sticky by symbol to maximize cache hit rate
  INDICATOR_CANDLE = 'indicator:candle',
  INDICATOR_TICK = 'indicator:tick',

  // Strategy tasks — least-loaded to balance computation
  STRATEGY_SIGNAL = 'strategy:signal',
  STRATEGY_HEARTBEAT = 'strategy:heartbeat',

  // Risk evaluation — round-robin (stateless, any worker is equivalent)
  RISK_EVALUATE = 'risk:evaluate',

  // Order execution — sticky by account to serialize fills correctly
  EXECUTION_SUBMIT = 'execution:submit',
  EXECUTION_CANCEL = 'execution:cancel',

  // Analytics — round-robin (read-only, no state affinity)
  ANALYTICS_COMPUTE = 'analytics:compute',
  ANALYTICS_EXPORT = 'analytics:export',

  // Backtesting — least-loaded (CPU-intensive)
  BACKTEST_RUN = 'backtest:run',
  BACKTEST_REPLAY = 'backtest:replay',

  // Paper trading — sticky by account
  PAPER_TRADING_FILL = 'paper-trading:fill',
}

export type LoadBalancingStrategy = 'round-robin' | 'least-loaded' | 'sticky' | 'weighted';

export interface TaskTypeConfig {
  readonly capability: WorkerCapability;
  readonly strategy: LoadBalancingStrategy;
  /**
   * For 'sticky' strategy: the key in TaskDescriptor.metadata that provides
   * the affinity value. e.g. 'symbol' → all tasks for the same symbol go to
   * the same worker.
   */
  readonly stickyKey?: string;
}

/**
 * Static routing table: task type → capability + load-balancing strategy.
 *
 * Design rationale per task type:
 *
 * INDICATOR_*    → sticky/symbol: indicator calculators maintain sliding
 *                  window state per symbol. Routing the same symbol to the
 *                  same worker avoids reloading that state from Redis on
 *                  every tick (warm in-process cache).
 *
 * STRATEGY_*     → least-loaded: strategies are stateful but not
 *                  symbol-bound; spreading them by load prevents one slow
 *                  strategy from blocking others on the same node.
 *
 * RISK_EVALUATE  → round-robin: risk evaluation is stateless (reads limits
 *                  from Redis, validates against current position snapshot).
 *
 * EXECUTION_*    → sticky/accountId: fills for the same account must be
 *                  serialized to prevent race conditions on position tracking.
 *
 * ANALYTICS_*    → round-robin: analytics are pure-function computation
 *                  over snapshots; no affinity needed.
 *
 * BACKTEST_*     → least-loaded: CPU-intensive; spread to lightest worker.
 *
 * PAPER_TRADING  → sticky/accountId: same as execution — fills must be
 *                  serialized per paper account.
 */
export const TASK_TYPE_CONFIG: Record<TaskType, TaskTypeConfig> = {
  [TaskType.INDICATOR_CANDLE]: {
    capability: WorkerCapability.INDICATOR,
    strategy: 'sticky',
    stickyKey: 'symbol',
  },
  [TaskType.INDICATOR_TICK]: {
    capability: WorkerCapability.INDICATOR,
    strategy: 'sticky',
    stickyKey: 'symbol',
  },
  [TaskType.STRATEGY_SIGNAL]: { capability: WorkerCapability.STRATEGY, strategy: 'least-loaded' },
  [TaskType.STRATEGY_HEARTBEAT]: {
    capability: WorkerCapability.STRATEGY,
    strategy: 'least-loaded',
  },
  [TaskType.RISK_EVALUATE]: { capability: WorkerCapability.RISK, strategy: 'round-robin' },
  [TaskType.EXECUTION_SUBMIT]: {
    capability: WorkerCapability.EXECUTION,
    strategy: 'sticky',
    stickyKey: 'accountId',
  },
  [TaskType.EXECUTION_CANCEL]: {
    capability: WorkerCapability.EXECUTION,
    strategy: 'sticky',
    stickyKey: 'accountId',
  },
  [TaskType.ANALYTICS_COMPUTE]: { capability: WorkerCapability.ANALYTICS, strategy: 'round-robin' },
  [TaskType.ANALYTICS_EXPORT]: { capability: WorkerCapability.ANALYTICS, strategy: 'round-robin' },
  [TaskType.BACKTEST_RUN]: { capability: WorkerCapability.BACKTEST, strategy: 'least-loaded' },
  [TaskType.BACKTEST_REPLAY]: { capability: WorkerCapability.BACKTEST, strategy: 'least-loaded' },
  [TaskType.PAPER_TRADING_FILL]: {
    capability: WorkerCapability.PAPER_TRADING,
    strategy: 'sticky',
    stickyKey: 'accountId',
  },
};

/**
 * TaskDescriptor is the payload the task router receives to make a routing
 * decision. Metadata is task-type-specific and carries the values needed
 * by the chosen load-balancing strategy (e.g. symbol, accountId).
 */
export interface TaskDescriptor {
  readonly type: TaskType;
  /** Arbitrary metadata; sticky balancer reads the stickyKey field from here. */
  readonly metadata: Record<string, string>;
  /** Task payload — forwarded verbatim to the target worker's queue. */
  readonly payload: unknown;
  /** ISO-8601 timestamp when this task was created (for latency tracking). */
  readonly createdAt: string;
  /** Caller-supplied correlation ID for end-to-end tracing. */
  readonly correlationId?: string;
}

/**
 * RoutingDecision is returned by the task router when a target worker is found.
 */
export interface RoutingDecision {
  readonly targetNodeId: string;
  readonly taskType: TaskType;
  readonly strategy: LoadBalancingStrategy;
}
