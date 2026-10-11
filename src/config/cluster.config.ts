import { registerAs } from '@nestjs/config';
import { hostname } from 'os';

export type TaskDistributionStrategy = 'round-robin' | 'least-loaded' | 'sticky' | 'weighted';

export interface ClusterConfig {
  /**
   * Whether horizontal clustering is active. When false the process behaves
   * as a conventional single-instance deployment and every Redis-backed
   * cluster service is a no-op. When true the Redis-backed Lock, Cache, and
   * Queue providers replace their in-memory counterparts automatically.
   */
  readonly enabled: boolean;

  /**
   * Stable identifier for this worker process. Defaults to
   * <hostname>:<pid> so it is unique across physical nodes even when
   * multiple workers share the same hostname (container orchestrators set
   * the hostname to the pod name, making this unambiguous per replica).
   * Override via CLUSTER_NODE_ID if you want a human-readable label.
   */
  readonly nodeId: string;

  /** Human-readable label advertised in the registry (optional). */
  readonly nodeLabel: string;

  /** Comma-separated list of capabilities this node handles. */
  readonly capabilities: string[];

  // ── Heartbeat ──────────────────────────────────────────────────────────────
  /** How often this worker publishes its heartbeat to Redis (ms). */
  readonly heartbeatIntervalMs: number;
  /** TTL of the heartbeat key in Redis. Must be > heartbeatIntervalMs. */
  readonly heartbeatTtlMs: number;
  /** How often the leader scans for dead workers (ms). */
  readonly deadWorkerCheckIntervalMs: number;

  // ── Leader Election ────────────────────────────────────────────────────────
  /** TTL of the leader lease key in Redis (ms). */
  readonly leaderLeaseTtlMs: number;
  /** How often the current leader renews its lease (ms). Must be < leaderLeaseTtlMs. */
  readonly leaderRenewalIntervalMs: number;

  // ── Task Distribution ──────────────────────────────────────────────────────
  /** Default load-balancing strategy. Per-task-type strategies override this. */
  readonly taskDistributionStrategy: TaskDistributionStrategy;

  // ── Metrics ────────────────────────────────────────────────────────────────
  /** How often this worker publishes its resource metrics to Redis (ms). */
  readonly metricsPublishIntervalMs: number;
  /** TTL of published worker metrics in Redis (ms). */
  readonly metricsTtlMs: number;

  // ── Distributed Locking (Redlock-style) ───────────────────────────────────
  /** Default TTL for distributed locks if none is specified by the caller (ms). */
  readonly defaultLockTtlMs: number;
  /** Maximum time to wait when trying to acquire a lock (ms). */
  readonly lockWaitMs: number;
  /** Interval between lock acquisition retries (ms). */
  readonly lockRetryIntervalMs: number;
  /** Jitter added to lockRetryIntervalMs to prevent thundering herd (ms). */
  readonly lockRetryJitterMs: number;
}

export const clusterConfig = registerAs('cluster', (): ClusterConfig => ({
  enabled: process.env.CLUSTER_ENABLED === 'true',
  nodeId: process.env.CLUSTER_NODE_ID ?? `${hostname()}:${process.pid}`,
  nodeLabel: process.env.CLUSTER_NODE_LABEL ?? '',
  capabilities: (
    process.env.CLUSTER_WORKER_CAPABILITIES ??
    'indicator,strategy,analytics,backtest,risk,execution'
  )
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean),

  heartbeatIntervalMs: parseInt(process.env.CLUSTER_HEARTBEAT_INTERVAL_MS ?? '3000', 10),
  heartbeatTtlMs: parseInt(process.env.CLUSTER_HEARTBEAT_TTL_MS ?? '10000', 10),
  deadWorkerCheckIntervalMs: parseInt(
    process.env.CLUSTER_DEAD_WORKER_CHECK_INTERVAL_MS ?? '5000',
    10,
  ),

  leaderLeaseTtlMs: parseInt(process.env.CLUSTER_LEADER_LEASE_TTL_MS ?? '30000', 10),
  leaderRenewalIntervalMs: parseInt(process.env.CLUSTER_LEADER_RENEWAL_INTERVAL_MS ?? '10000', 10),

  taskDistributionStrategy: (process.env.CLUSTER_TASK_DISTRIBUTION_STRATEGY ??
    'round-robin') as TaskDistributionStrategy,

  metricsPublishIntervalMs: parseInt(process.env.CLUSTER_METRICS_PUBLISH_INTERVAL_MS ?? '5000', 10),
  metricsTtlMs: parseInt(process.env.CLUSTER_METRICS_TTL_MS ?? '30000', 10),

  defaultLockTtlMs: parseInt(process.env.CLUSTER_DEFAULT_LOCK_TTL_MS ?? '30000', 10),
  lockWaitMs: parseInt(process.env.CLUSTER_LOCK_WAIT_MS ?? '5000', 10),
  lockRetryIntervalMs: parseInt(process.env.CLUSTER_LOCK_RETRY_INTERVAL_MS ?? '50', 10),
  lockRetryJitterMs: parseInt(process.env.CLUSTER_LOCK_RETRY_JITTER_MS ?? '25', 10),
}));
