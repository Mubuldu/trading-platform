# Scaling Guide

This guide covers how to scale the trading platform from one node to hundreds, which components can be scaled independently, what environment variables control the behavior, and how to capacity-plan a cluster.

---

## Table of Contents

1. [Quick Start — First Cluster Node](#quick-start--first-cluster-node)
2. [Adding Nodes](#adding-nodes)
3. [Independent Component Scaling](#independent-component-scaling)
4. [Environment Variables Reference](#environment-variables-reference)
5. [Docker Compose Cluster](#docker-compose-cluster)
6. [Capacity Planning](#capacity-planning)
7. [Tuning Heartbeat and Leader Election](#tuning-heartbeat-and-leader-election)
8. [Tuning Load Balancing](#tuning-load-balancing)
9. [Observability at Scale](#observability-at-scale)

---

## Quick Start — First Cluster Node

By default `CLUSTER_ENABLED` is `false` — the platform runs entirely in-process with in-memory providers (lock, cache, queue). No Redis cluster setup is needed.

To enable clustering:

```bash
# .env or environment
CLUSTER_ENABLED=true
REDIS_URL=redis://your-redis-host:6379
```

Restart the node. It will:

1. Register itself in `cluster:worker-index`.
2. Start publishing heartbeats every 3 s.
3. Attempt leader election via `SET cluster:leader NX`.
4. Switch to Redis-backed lock, cache, and queue providers automatically.

No code changes. No business-logic changes.

---

## Adding Nodes

Every additional node runs the same binary with the same environment. Nodes differentiate themselves via `CLUSTER_NODE_ID` (or auto-generated `hostname:PID`).

```bash
# Node 2
CLUSTER_ENABLED=true
CLUSTER_NODE_ID=worker-2
REDIS_URL=redis://shared-redis:6379
DATABASE_URL=postgresql://shared-db:5432/trading

# Node 3
CLUSTER_ENABLED=true
CLUSTER_NODE_ID=worker-3
REDIS_URL=redis://shared-redis:6379
DATABASE_URL=postgresql://shared-db:5432/trading
```

All nodes discover each other through Redis automatically within one heartbeat interval (~3 s).

### With Docker Compose

```bash
# Scale to 5 API replicas
docker compose -f docker-compose.cluster.yml up --scale api=5
```

Docker sets each container's hostname to its container ID, so `CLUSTER_NODE_ID` auto-generates uniquely from `hostname():PID`.

### With Kubernetes

```yaml
env:
  - name: CLUSTER_ENABLED
    value: "true"
  - name: CLUSTER_NODE_ID
    valueFrom:
      fieldRef:
        fieldPath: metadata.name   # Pod name — unique per replica
```

---

## Independent Component Scaling

Each worker type can be scaled without affecting others. Control which capabilities a node advertises via `CLUSTER_WORKER_CAPABILITIES`.

### Scale Indicators Only

Indicator workers maintain per-symbol sliding-window state. Sticky routing ensures all tasks for a given symbol route to the same worker (rendezvous hashing), so each worker only needs to cache its assigned symbols.

```bash
# indicator-only node
CLUSTER_WORKER_CAPABILITIES=indicator
```

Add nodes when: symbol count grows, or per-symbol computation latency increases.

**Scaling formula**: N indicator workers can handle N × `(symbols per worker)` symbols at target latency. Each symbol routes to one worker; adding a worker redistributes ~(1/N_new) of symbols automatically.

### Scale Strategies Only

Strategy workers are stateful but not symbol-bound. Least-loaded routing distributes them by CPU/task count.

```bash
CLUSTER_WORKER_CAPABILITIES=strategy
```

Add nodes when: strategy evaluation latency increases under load, or CPU utilization on strategy workers is sustained >70%.

### Scale Analytics Only

Analytics tasks are stateless read-only computations. Round-robin distributes them evenly.

```bash
CLUSTER_WORKER_CAPABILITIES=analytics
```

Add nodes freely — no sticky state to migrate.

### Scale Backtesting Only

Backtesting is the most CPU-intensive workload. Least-loaded routing sends each run to the lightest available node.

```bash
CLUSTER_WORKER_CAPABILITIES=backtest
```

Backtest workers can run on separate physical hardware (e.g. compute-optimized instances) without affecting API latency.

### Scale Risk Only

Risk evaluation is stateless (reads limits from Redis, validates against snapshots). Round-robin.

```bash
CLUSTER_WORKER_CAPABILITIES=risk
```

### Scale Execution / Paper Trading Only

Execution and paper-trading fills are sticky by `accountId` to serialize operations per account.

```bash
CLUSTER_WORKER_CAPABILITIES=execution,paper_trading
```

If a sticky execution worker goes down, the sticky balancer automatically reassigns that account's tasks to the next-best worker using rendezvous hashing — no manual intervention.

### Mixed Node (all capabilities)

```bash
CLUSTER_WORKER_CAPABILITIES=indicator,strategy,risk,execution,analytics,backtest,paper_trading
```

This is the default. Suitable for small clusters where separation is not yet needed.

---

## Environment Variables Reference

### Core Cluster Settings

| Variable | Default | Description |
|---|---|---|
| `CLUSTER_ENABLED` | `false` | Enable horizontal clustering. `true` activates Redis-backed providers. |
| `CLUSTER_NODE_ID` | `hostname:PID` | Stable unique identifier for this node. Set explicitly in Kubernetes (`metadata.name`). |
| `CLUSTER_NODE_LABEL` | `''` | Human-readable label shown in dashboards. |
| `CLUSTER_WORKER_CAPABILITIES` | `indicator,strategy,analytics,backtest,risk,execution` | Comma-separated list of workloads this node accepts. |

### Heartbeat

| Variable | Default | Description |
|---|---|---|
| `CLUSTER_HEARTBEAT_INTERVAL_MS` | `3000` | How often (ms) this node publishes its heartbeat key to Redis. |
| `CLUSTER_HEARTBEAT_TTL_MS` | `10000` | TTL (ms) of the heartbeat key. Must be > `CLUSTER_HEARTBEAT_INTERVAL_MS`. Typically 3× the interval. |
| `CLUSTER_DEAD_WORKER_CHECK_INTERVAL_MS` | `5000` | How often (ms) the leader scans for and removes dead workers. |

**Constraint**: `CLUSTER_HEARTBEAT_TTL_MS` must be strictly greater than `CLUSTER_HEARTBEAT_INTERVAL_MS`. Recommended ratio: `TTL = INTERVAL × 3`. Setting TTL too close to the interval causes false positives during GC pauses.

### Leader Election

| Variable | Default | Description |
|---|---|---|
| `CLUSTER_LEADER_LEASE_TTL_MS` | `30000` | TTL (ms) of the leader key. If the leader crashes without releasing, followers wait at most this long before electing a new one. |
| `CLUSTER_LEADER_RENEWAL_INTERVAL_MS` | `10000` | How often (ms) the current leader renews its lease. Must be < `CLUSTER_LEADER_LEASE_TTL_MS`. Recommended: ≤ `TTL / 3`. |

**Constraint**: `CLUSTER_LEADER_RENEWAL_INTERVAL_MS < CLUSTER_LEADER_LEASE_TTL_MS`. If renewal is slower than the lease TTL, the leader loses its key between renewals, causing repeated election events.

### Task Distribution

| Variable | Default | Description |
|---|---|---|
| `CLUSTER_TASK_DISTRIBUTION_STRATEGY` | `round-robin` | Default balancing strategy for task types not covered by the static routing table. Values: `round-robin`, `least-loaded`, `sticky`, `weighted`. |

### Metrics

| Variable | Default | Description |
|---|---|---|
| `CLUSTER_METRICS_PUBLISH_INTERVAL_MS` | `5000` | How often (ms) each node publishes CPU/memory/task metrics to Redis. |
| `CLUSTER_METRICS_TTL_MS` | `30000` | TTL (ms) of published metrics. Should be several multiples of the publish interval. |

### Distributed Locking

| Variable | Default | Description |
|---|---|---|
| `CLUSTER_DEFAULT_LOCK_TTL_MS` | `30000` | Default TTL (ms) for distributed locks when the caller does not specify one. |
| `CLUSTER_LOCK_WAIT_MS` | `5000` | Maximum time (ms) to wait for a lock before returning `Err(LockAcquisitionError)`. |
| `CLUSTER_LOCK_RETRY_INTERVAL_MS` | `50` | Base interval (ms) between lock acquisition retries. |
| `CLUSTER_LOCK_RETRY_JITTER_MS` | `25` | Random jitter (ms) added to the retry interval to prevent thundering herd. |

---

## Docker Compose Cluster

`docker-compose.cluster.yml` provides a ready-to-run local cluster:

```
Services:
  nginx           — least_conn load balancer on port 80
  api             — scalable NestJS replicas (default: 1)
  redis-primary   — primary Redis node
  redis-replica   — streaming replica
  redis-sentinel  — automatic failover monitor
  postgres-primary — primary database
  postgres-replica — streaming replica
```

### Start a 3-node cluster

```bash
docker compose -f docker-compose.cluster.yml up --scale api=3 -d
```

### Verify cluster membership

```bash
# Redis CLI
redis-cli SMEMBERS cluster:worker-index
```

### Check leader

```bash
redis-cli GET cluster:leader
```

### Scale up live

```bash
docker compose -f docker-compose.cluster.yml up --scale api=5 --no-recreate -d
```

New nodes join within one heartbeat interval. The task router starts including them immediately.

---

## Capacity Planning

### Symbols per Indicator Worker

Each symbol requires:
- One sliding-window buffer per indicator type (typically 8–64 KB per symbol)
- CPU for continuous OHLCV processing

**Rule of thumb**: 500–2000 symbols per indicator worker at <50 ms latency target. Start with 1000 and measure.

### Strategies per Strategy Worker

Strategy evaluation is O(N indicators × M positions). Execution latency depends heavily on strategy complexity.

**Rule of thumb**: 20–100 strategies per worker. Add a worker when average strategy evaluation latency exceeds 200 ms.

### Concurrent Backtest Workers

Each backtest run fully saturates one CPU core during replay. Worker count should match available CPU core count minus overhead.

**Rule of thumb**: `worker_count = vCPU_count × 0.8` (leave 20% for heartbeat, Redis IO, OS).

### Redis Memory

Estimate Redis memory usage:

```
cluster:workers:{nodeId}     ~   2 KB per worker  (Hash with ~15 fields)
cluster:hb:{nodeId}          ~   50 B per worker  (string "1")
cluster:metrics:{nodeId}     ~   500 B per worker (JSON blob)
cluster:lock:{resource}      ~   100 B per lock   (varies by lock name)
queue:{name}                 ~   200 B per message × queue depth
cluster:leader               ~   50 B
cluster:worker-index         ~   50 B + nodeId length per member
```

For 100 workers with 10,000-message queues: approximately 30 MB of overhead. Redis memory is dominated by market data caching, not cluster metadata.

---

## Tuning Heartbeat and Leader Election

### High-Churn Environments (containers restarting frequently)

Reduce TTL and interval so stale entries clean up faster:

```bash
CLUSTER_HEARTBEAT_INTERVAL_MS=1000
CLUSTER_HEARTBEAT_TTL_MS=3000
CLUSTER_DEAD_WORKER_CHECK_INTERVAL_MS=2000
CLUSTER_LEADER_LEASE_TTL_MS=10000
CLUSTER_LEADER_RENEWAL_INTERVAL_MS=3000
```

Trade-off: more Redis writes. At 100 workers × 1 s interval = 100 heartbeat writes/s — well within Redis capacity.

### Stable Environments (long-running VMs)

Use larger values to reduce Redis chatter:

```bash
CLUSTER_HEARTBEAT_INTERVAL_MS=5000
CLUSTER_HEARTBEAT_TTL_MS=15000
CLUSTER_DEAD_WORKER_CHECK_INTERVAL_MS=10000
CLUSTER_LEADER_LEASE_TTL_MS=60000
CLUSTER_LEADER_RENEWAL_INTERVAL_MS=20000
```

Stale entries last longer on crash — acceptable when containers don't restart frequently.

---

## Tuning Load Balancing

### Indicator Workers with Uneven Symbol Distribution

If some symbols generate dramatically more ticks than others (e.g. BTC/USDT vs. an illiquid alt), sticky routing may create hot workers. Mitigate by:

1. Monitoring `cluster:metrics:*` for CPU imbalance.
2. Splitting the heavy symbol to its own dedicated worker: `CLUSTER_WORKER_CAPABILITIES=indicator` with a capability filter at the application layer.

### Backtest Workers with Long-Running Jobs

Least-loaded routing uses a snapshot of `activeTaskCount` at routing time, not actual completion. If backtest runs last minutes, the count diverges from real load.

Mitigation: callers should increment `activeTaskCount` via `WorkerIdService.incrementActiveTasks()` when a run starts and decrement on completion. The heartbeat propagates the updated count to the registry.

### Weighted Balancer for Mixed Hardware

If the cluster runs on a mix of instance types (e.g. 4-core + 16-core), configure strategy workers on large instances as `CLUSTER_WORKER_CAPABILITIES=strategy,backtest` and smaller instances as `CLUSTER_WORKER_CAPABILITIES=analytics,risk`. The weighted balancer will naturally route fewer tasks to heavier-loaded nodes, but hardware-aware routing is better achieved by setting capabilities explicitly.

---

## Observability at Scale

### Cluster Health Endpoint

```
GET /health
```

Returns the cluster health status including:
- `totalWorkers` — registered live workers
- `byCapability` — breakdown per capability
- `currentLeader` — nodeId of the current leader
- `isLocalLeader` — whether this instance is the leader

### Worker Metrics Dashboard

```bash
# All worker metrics (raw JSON)
for key in $(redis-cli --scan --pattern 'cluster:metrics:*'); do
  echo "=== $key ===" && redis-cli GET $key | jq .
done
```

### Queue Depth Monitoring

```bash
# Pending message count per queue
redis-cli XLEN queue:indicator
redis-cli XLEN queue:strategy
redis-cli XLEN queue:backtest
```

### Dead Letter Queue Inspection

```bash
# View failed messages
redis-cli XRANGE queue:indicator:dlq - + COUNT 10
```

### Leader Check

```bash
redis-cli GET cluster:leader
redis-cli TTL cluster:leader   # seconds remaining on lease
```
