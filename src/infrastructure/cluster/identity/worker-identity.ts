/**
 * Worker identity model — describes a single node in the cluster.
 *
 * WorkerCapability drives task routing: the task router matches a task's
 * required capability against the set of capabilities each worker advertises.
 * A worker may hold multiple capabilities (e.g. INDICATOR + STRATEGY) so
 * that small deployments run every role on a single node and large ones
 * split them across dedicated pools.
 *
 * WorkerStatus is the lifecycle state as tracked in Redis. The state machine:
 *   STARTING → ACTIVE ↔ DEGRADED → STOPPING → OFFLINE
 * OFFLINE entries are pruned by the leader's dead-worker check loop.
 */

export enum WorkerCapability {
  INDICATOR = 'indicator',
  STRATEGY = 'strategy',
  RISK = 'risk',
  EXECUTION = 'execution',
  ANALYTICS = 'analytics',
  BACKTEST = 'backtest',
  PAPER_TRADING = 'paper-trading',
  API = 'api',
}

export enum WorkerStatus {
  STARTING = 'starting',
  ACTIVE = 'active',
  DEGRADED = 'degraded',
  STOPPING = 'stopping',
  OFFLINE = 'offline',
}

export interface WorkerInfo {
  /** Unique, stable identifier for this worker process. */
  readonly nodeId: string;
  /** Human-readable label (optional, used in dashboards). */
  readonly nodeLabel: string;
  /** Hostname of the physical or virtual machine. */
  readonly hostname: string;
  /** OS process ID. */
  readonly pid: number;
  /** Capabilities this worker handles. */
  readonly capabilities: WorkerCapability[];
  /** Current lifecycle state. */
  status: WorkerStatus;
  /** ISO-8601 timestamp when this worker started. */
  readonly startedAt: string;
  /** ISO-8601 timestamp of the most recent heartbeat. */
  lastHeartbeatAt: string;
  /** Current CPU utilization 0–100. Updated with each heartbeat. */
  cpuPercent: number;
  /** Current RSS memory usage in bytes. Updated with each heartbeat. */
  memoryBytes: number;
  /** Number of active task queue slots being processed. */
  activeTaskCount: number;
}

/**
 * WorkerSnapshot is the serialized form stored in Redis (all string values).
 * Redis Hashes store string→string pairs. WorkerRegistryService converts
 * between WorkerInfo and WorkerSnapshot using JSON for arrays and numerics.
 */
export interface WorkerSnapshot {
  nodeId: string;
  nodeLabel: string;
  hostname: string;
  pid: string; // number stored as string
  capabilities: string; // JSON array
  status: string;
  startedAt: string;
  lastHeartbeatAt: string;
  cpuPercent: string; // number stored as string
  memoryBytes: string; // number stored as string
  activeTaskCount: string;
  // Index signature allows WorkerSnapshot to be used as Record<string, string>
  // — required because Redis HGETALL returns Record<string, string>.
  [key: string]: string;
}

/** Serialize a WorkerInfo into a flat string map for Redis HSET. */
export function serializeWorkerInfo(info: WorkerInfo): WorkerSnapshot {
  return {
    nodeId: info.nodeId,
    nodeLabel: info.nodeLabel,
    hostname: info.hostname,
    pid: String(info.pid),
    capabilities: JSON.stringify(info.capabilities),
    status: info.status,
    startedAt: info.startedAt,
    lastHeartbeatAt: info.lastHeartbeatAt,
    cpuPercent: String(info.cpuPercent),
    memoryBytes: String(info.memoryBytes),
    activeTaskCount: String(info.activeTaskCount),
  };
}

/** Deserialize a Redis HGETALL result back into a WorkerInfo. */
export function deserializeWorkerInfo(snapshot: Record<string, string>): WorkerInfo {
  return {
    nodeId: snapshot.nodeId,
    nodeLabel: snapshot.nodeLabel ?? '',
    hostname: snapshot.hostname ?? '',
    pid: parseInt(snapshot.pid ?? '0', 10),
    capabilities: JSON.parse(snapshot.capabilities ?? '[]') as WorkerCapability[],
    status: (snapshot.status ?? WorkerStatus.OFFLINE) as WorkerStatus,
    startedAt: snapshot.startedAt ?? new Date().toISOString(),
    lastHeartbeatAt: snapshot.lastHeartbeatAt ?? new Date().toISOString(),
    cpuPercent: parseFloat(snapshot.cpuPercent ?? '0'),
    memoryBytes: parseInt(snapshot.memoryBytes ?? '0', 10),
    activeTaskCount: parseInt(snapshot.activeTaskCount ?? '0', 10),
  };
}
