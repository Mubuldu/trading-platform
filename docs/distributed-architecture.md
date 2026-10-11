# Distributed Architecture

This document describes how the trading platform distributes work across multiple nodes. A single-node deployment requires no configuration changes — horizontal scaling is activated by setting `CLUSTER_ENABLED=true` and pointing nodes at the same Redis instance.

---

## Table of Contents

1. [System Topology](#system-topology)
2. [Component Map](#component-map)
3. [Redis Key Layout](#redis-key-layout)
4. [Worker Identity and Registry](#worker-identity-and-registry)
5. [Heartbeat and Liveness](#heartbeat-and-liveness)
6. [Leader Election Protocol](#leader-election-protocol)
7. [Task Routing Table](#task-routing-table)
8. [Load-Balancing Strategies](#load-balancing-strategies)
9. [Distributed Locking](#distributed-locking)
10. [Queue Architecture (Redis Streams)](#queue-architecture-redis-streams)
11. [Metrics Collection](#metrics-collection)
12. [Provider Swapping](#provider-swapping)

---

## System Topology

```
                       ┌─────────────────────────────┐
  External traffic ──► │  nginx  (least_conn LB)      │
                       └──────────────┬──────────────┘
                                      │ HTTP
              ┌───────────────────────┼───────────────────────┐
              ▼                       ▼                       ▼
        ┌──────────┐           ┌──────────┐           ┌──────────┐
        │  API-1   │           │  API-2   │           │  API-N   │
        │ (NestJS) │           │ (NestJS) │           │ (NestJS) │
        └────┬─────┘           └────┬─────┘           └────┬─────┘
             │                      │                       │
             └──────────────────────┼───────────────────────┘
                                    │ ioredis
                          ┌─────────▼──────────┐
                          │   Redis Cluster     │
                          │  ┌───┐ ┌───┐ ┌───┐ │
                          │  │ P │ │ R │ │ S │ │  P=Primary R=Replica S=Sentinel
                          │  └───┘ └───┘ └───┘ │
                          └─────────────────────┘
                                    │
             ┌──────────────────────┼───────────────────────┐
             ▼                      ▼                       ▼
    ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
    │ Strategy Worker │   │ Indicator Worker │   │ Analytics Worker│
    └─────────────────┘   └─────────────────┘   └─────────────────┘
             │                      │                       │
             └──────────────────────┼───────────────────────┘
                                    │
                          ┌─────────▼──────────┐
                          │  PostgreSQL Cluster │
                          │   Primary + Replica │
                          └─────────────────────┘
```

Every API instance is both a client and a worker. A node can be configured to serve only API traffic (no worker capabilities) or to process only background tasks (no HTTP listener) — both shapes use the same codebase.

---

## Component Map

| Module | Class | Responsibility |
|---|---|---|
| `ClusterModule` | `ClusterModule` | Bootstrap: registers health, lifecycle, starts all cluster services |
| Identity | `WorkerIdService` | Owns the stable `nodeId` and mutable `WorkerInfo` |
| Registry | `WorkerRegistryService` | Redis Hashes + Set — persists worker metadata |
| Heartbeat | `HeartbeatService` | Liveness key; leader-only dead-worker scanner |
| Discovery | `WorkerDiscoveryService` | Live view of the cluster — filters by capability and liveness |
| Leader Election | `LeaderElectionService` | Redis SET NX + Lua-fenced renewal; emits gain/lose events |
| Task Router | `TaskRouterService` | Maps `TaskDescriptor` → `RoutingDecision` via strategy registry |
| Balancers | `RoundRobinBalancer` | Even cycling across workers |
| | `LeastLoadedBalancer` | Composite score (tasks, CPU, memory) |
| | `StickyBalancer` | Rendezvous hashing for stable affinity |
| | `WeightedBalancer` | Inverse-load weighted random sampling |
| Health | `ClusterHealthService` | Exposes cluster health to the global health endpoint |
| Metrics | `ClusterMetricsService` | Per-node metrics in Redis; cluster-wide aggregation |

---

## Redis Key Layout

All cluster keys are prefixed to avoid collision with application keys.

```
cluster:workers:{nodeId}          HASH   Worker metadata (capabilities, status, CPU, memory, tasks)
cluster:worker-index              SET    All registered nodeIds — O(1) membership test
cluster:hb:{nodeId}               STRING Heartbeat liveness key; TTL=heartbeatTtlMs
cluster:leader                    STRING Current leader nodeId; TTL=leaderLeaseTtlMs
cluster:metrics:{nodeId}          STRING JSON blob of worker metrics; TTL=metricsTtlMs
cluster:lock:{resource}           STRING Distributed lock; value=nodeId; TTL=lockTtlMs
queue:{name}                      STREAM Redis Streams for task queuing (consumer group: workers)
queue:{name}:dlq                  STREAM Dead-letter queue for failed messages
queue:dedup:{name}:{dedupKey}     STRING Deduplication guard; TTL=dedupTtlMs
```

No keyspace notifications are required. Dead-worker detection uses pipeline-batched `EXISTS` polling — zero Redis configuration changes needed.

---

## Worker Identity and Registry

### Registration Flow

```
1. WorkerIdService resolves nodeId (env CLUSTER_NODE_ID or hostname():PID)
2. WorkerIdService builds initial WorkerInfo (status=STARTING, all capabilities declared)
3. WorkerRegistryService.register(info):
     pipeline HSET cluster:workers:{nodeId} <all fields as flat strings>
     pipeline SADD cluster:worker-index {nodeId}
     pipeline.exec()                          ← one round-trip
4. WorkerIdService.updateStatus(ACTIVE)
5. HeartbeatService begins publishing liveness keys
```

### WorkerInfo Schema (stored as Redis Hash fields)

```
nodeId           string   Stable unique identifier
nodeLabel        string   Human-readable label (optional)
hostname         string   OS hostname
pid              string   Process ID
capabilities     string   Comma-separated WorkerCapability values
status           string   WorkerStatus enum value
startedAt        string   ISO-8601
lastHeartbeatAt  string   ISO-8601; updated each heartbeat
cpuPercent       string   0–100 float
memoryBytes      string   RSS in bytes
activeTaskCount  string   In-flight tasks (incremented/decremented by callers)
```

### Deregistration Flow

```
1. onModuleDestroy() fires (NestJS graceful shutdown)
2. HeartbeatService.onModuleDestroy():
     DEL cluster:hb:{nodeId}
     WorkerRegistryService.deregister(nodeId)
3. LeaderElectionService.onModuleDestroy():
     Lua fenced-release cluster:leader (only if we hold it)
```

---

## Heartbeat and Liveness

```
Every heartbeatIntervalMs (default 3 s):
  1. Measure CPU: process.cpuUsage(prev) / (elapsed µs × CPU count) → 0–100%
  2. Measure memory: process.memoryUsage().rss
  3. WorkerIdService.refreshMetrics(cpuPercent)
  4. SET cluster:hb:{nodeId} 1 PX {heartbeatTtlMs}        ← atomic, overwrites TTL
  5. WorkerRegistryService.updateFields(nodeId, { cpuPercent, memoryBytes, lastHeartbeatAt })
```

A worker is **alive** if `EXISTS cluster:hb:{nodeId}` returns 1. The key expires automatically if the process crashes or hangs — no explicit tombstone protocol needed.

### Dead-Worker Scanner (leader only)

Runs on `deadWorkerCheckIntervalMs` (default 5 s):

```
1. registryService.getAllWorkers() → list of all registered nodeIds
2. Build pipeline: EXISTS cluster:hb:{nodeId} for each
3. pipeline.exec() → one round-trip regardless of worker count
4. For each nodeId where EXISTS=0:
     WorkerRegistryService.deregister(nodeId)
     logger.warn('dead worker removed', { nodeId })
```

This means deregistration lag is at most `deadWorkerCheckIntervalMs`. Routing queries call `WorkerDiscoveryService.getActiveWorkers()` which cross-checks heartbeat keys before returning candidates, so stale registry entries never receive tasks in the interim.

---

## Leader Election Protocol

Only one node performs background maintenance (dead-worker scanning, cluster-wide metrics aggregation). Leader election uses Redis SET NX with a time-bounded lease:

### Acquisition

```
SET cluster:leader <nodeId> NX PX <leaderLeaseTtlMs>
```

- Returns `'OK'` → this node is the new leader. Emit `leadership:gained`.
- Returns `null` → another node holds the key. Stay follower.

Attempted every `leaderLeaseTtlMs` by all followers (jittered by a small random offset to avoid thundering herd).

### Lease Renewal (leader only, every leaderRenewalIntervalMs)

Renewal uses a Lua script to prevent stale writes from a GC-paused process:

```lua
-- RENEWAL_SCRIPT
local current = redis.call('GET', KEYS[1])
if current == ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return 1
end
return 0
```

- Returns `1` → lease renewed. Emit `leadership:renewed`.
- Returns `0` → key was taken by another node (network partition, GC pause). Emit `leadership:lost`. Stop dead-worker scanner. Attempt re-election at next interval.

### Release (shutdown)

```lua
-- RELEASE_SCRIPT
local current = redis.call('GET', KEYS[1])
if current == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
```

Fenced release: only deletes if we still hold the key. Prevents accidentally evicting a legitimate leader that took over during our downtime.

---

## Task Routing Table

The static routing table maps each `TaskType` to a worker capability and a load-balancing strategy. Sticky tasks also declare the `metadata` field whose value provides the affinity key.

| TaskType | Capability | Strategy | Sticky Key | Rationale |
|---|---|---|---|---|
| `indicator:candle` | INDICATOR | sticky | `symbol` | Warm in-process sliding-window cache per symbol |
| `indicator:tick` | INDICATOR | sticky | `symbol` | Same — avoids reloading state from Redis |
| `strategy:signal` | STRATEGY | least-loaded | — | Stateful but not symbol-bound; spread by load |
| `strategy:heartbeat` | STRATEGY | least-loaded | — | Same |
| `risk:evaluate` | RISK | round-robin | — | Stateless; any worker is equivalent |
| `execution:submit` | EXECUTION | sticky | `accountId` | Serialize fills per account to prevent races |
| `execution:cancel` | EXECUTION | sticky | `accountId` | Same serialization guarantee |
| `analytics:compute` | ANALYTICS | round-robin | — | Pure-function over snapshots; no affinity |
| `analytics:export` | ANALYTICS | round-robin | — | Same |
| `backtest:run` | BACKTEST | least-loaded | — | CPU-intensive; route to lightest worker |
| `backtest:replay` | BACKTEST | least-loaded | — | Same |
| `paper-trading:fill` | PAPER_TRADING | sticky | `accountId` | Same as execution — serialize per account |

---

## Load-Balancing Strategies

### Round Robin (`RoundRobinBalancer`)

Maintains a per-pool cursor in a `Map`. The pool key is the sorted concatenation of all worker nodeIds — any membership change (worker added/removed) triggers an automatic cursor reset, so the new pool starts from index 0 rather than skipping entries.

Guarantees exactly even distribution over N tasks when N is a multiple of the worker count.

### Least Loaded (`LeastLoadedBalancer`)

Computes a composite load score per worker:

```
score = (activeTaskCount / MAX_TASKS) × 0.5
      + (cpuPercent / 100)            × 0.3
      + (memoryBytes / 4 GB)          × 0.2
```

Selects the worker with the lowest score. Tie-break: lower `nodeId` lexicographically (deterministic, no randomness).

### Sticky (`StickyBalancer`) — Rendezvous Hashing

For each candidate worker, computes:

```
score = SHA-256(nodeId + ':' + stickyValue)  → hex string
```

Selects the worker with the highest hex score. Because the hash depends only on the (nodeId, stickyValue) pair, the winner for a given value is stable as long as that worker remains in the pool. When one worker leaves, only ~1/N values remap (vs. nearly all with modulo hashing).

Falls back to lexicographically first nodeId when no sticky value is provided.

### Weighted (`WeightedBalancer`)

Assigns each worker a weight:

```
weight = max(0.01, 1 - loadScore / 100)
```

`MIN_WEIGHT = 0.01` ensures saturated workers still receive ~1% of traffic (no starvation). Samples via cumulative-distribution-function weighted random selection. Best for variable-duration tasks where probabilistic spread is preferable to exact ordering.

---

## Distributed Locking

Uses `RedisLockProvider` (active when `CLUSTER_ENABLED=true`). Falls back to `InMemoryLockProvider` in single-node mode.

### Acquire

```
SET cluster:lock:{resource} {nodeId}:{token} NX PX {ttlMs}
```

Retries with jitter on failure:

```
wait = lockRetryIntervalMs + random(0, lockRetryJitterMs)
```

Gives up after `lockWaitMs` total and returns `Err(LockAcquisitionError)`.

### Release (Lua fenced)

```lua
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
```

The lock value includes a per-acquisition random token — only the exact acquirer can release it.

### withLock<T>()

```typescript
const result = await lockProvider.withLock('order:123', async () => {
  // critical section
}, { ttlMs: 10_000 });
```

Guarantees release even on thrown exceptions. For long operations, the caller is responsible for setting `ttlMs` appropriately.

---

## Queue Architecture (Redis Streams)

Uses `RedisQueueProvider` (active when `CLUSTER_ENABLED=true`). Falls back to `InMemoryQueueProvider`.

### Publishing

```
XADD {queue} MAXLEN ~ 10000 * type {type} payload {json} ...
```

`MAXLEN ~ N` trims the stream approximately to N entries, amortizing the cost.

### Consuming

```
XREADGROUP GROUP workers {consumerId} COUNT 1 BLOCK {blockMs} STREAMS {queue} >
```

- `>` reads only new (undelivered) messages.
- Unacknowledged messages remain in the PEL (Pending Entry List) and can be reclaimed via `XAUTOCLAIM` or by a monitoring process.
- After processing: `XACK {queue} workers {messageId}`.

### Dead-Letter Queue

After `maxRetries` failures, messages are moved to `{queue}:dlq`. The DLQ is a regular stream — inspect with `XRANGE {queue}:dlq - +`.

### Deduplication

```
SET queue:dedup:{queue}:{dedupKey} 1 NX PX {dedupTtlMs}
```

If the key already exists, the message is silently dropped. Use this for idempotent, event-driven tasks (e.g. "compute analytics for candle X").

---

## Metrics Collection

Each worker publishes a JSON blob every `metricsPublishIntervalMs` (default 5 s):

```
SET cluster:metrics:{nodeId} <json> PX <metricsTtlMs>
```

`ClusterMetricsService.getClusterMetrics()` reads all worker metrics in a pipeline (one round-trip) and aggregates:

- Average CPU across all live workers
- Total memory consumed
- Total active task count
- Per-worker breakdown

When a worker's metrics key has expired (worker crashed before graceful shutdown), the service synthesizes from the registry hash so the aggregate is always complete.

---

## Provider Swapping

`InfrastructureModule` uses factory providers that check `cluster.enabled` at startup:

```typescript
{
  provide: INFRASTRUCTURE_TOKENS.CACHE_PROVIDER,
  useFactory: (config, redis, logger) =>
    config.get('cluster').enabled
      ? new RedisCacheProvider(redis, logger)
      : new InMemoryCacheProvider(logger),
  inject: [ConfigService, RedisClientService, AppLoggerService],
}
```

All callers inject `INFRASTRUCTURE_TOKENS.CACHE_PROVIDER` (same for LOCK and QUEUE). They are completely unaware of which implementation is active. This is the "no business logic changes" guarantee.
