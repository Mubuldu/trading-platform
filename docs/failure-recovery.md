# Failure Recovery

This document describes what happens when each component of the distributed trading platform fails, how the system responds automatically, and what manual steps (if any) are needed for recovery.

---

## Table of Contents

1. [Worker Crash](#worker-crash)
2. [Node Crash (full host failure)](#node-crash-full-host-failure)
3. [Leader Crash](#leader-crash)
4. [Redis Primary Crash](#redis-primary-crash)
5. [Database Primary Crash](#database-primary-crash)
6. [Network Partition](#network-partition)
7. [Partial Degradation (DEGRADED status)](#partial-degradation-degraded-status)
8. [Queue Message Failure and DLQ Recovery](#queue-message-failure-and-dlq-recovery)
9. [Distributed Lock Expiry](#distributed-lock-expiry)
10. [Monitoring and Alerting During Failures](#monitoring-and-alerting-during-failures)

---

## Worker Crash

**Scenario**: A single NestJS process crashes mid-operation (segfault, OOM kill, unhandled rejection, SIGKILL).

### What happens automatically

| Time | Event |
|---|---|
| T+0 | Process exits. Heartbeat key `cluster:hb:{nodeId}` stops being renewed. |
| T+heartbeatTtlMs (default 10 s) | Heartbeat key expires in Redis. |
| T+deadWorkerCheckIntervalMs (default 5 s, max) | Leader's dead-worker scanner detects `EXISTS cluster:hb:{nodeId}` = 0. |
| T+scan | `WorkerRegistryService.deregister(nodeId)` removes the worker from `cluster:workers:{nodeId}` and `cluster:worker-index`. |
| Next routing call | `WorkerDiscoveryService.getActiveWorkers()` excludes the dead worker. Task router selects from remaining live workers. |

**Maximum rerouting lag**: `heartbeatTtlMs + deadWorkerCheckIntervalMs` = ~15 s with defaults. Reduce both for faster recovery at the cost of more Redis writes.

### In-flight tasks

- **Queue tasks** (Redis Streams): Unacknowledged messages remain in the Pending Entry List (PEL). They are not lost. A live worker can reclaim them via `XAUTOCLAIM` or the DLQ recovery process.
- **Direct routing decisions**: Callers that already received a `RoutingDecision` targeting the dead worker will fail to deliver. Retry logic at the caller layer should route the task again via `TaskRouterService.route()`.
- **Distributed locks held by the dead worker**: Expire automatically at `lockTtlMs`. No deadlock — the next requester acquires the lock after expiry.

### No manual steps required.

---

## Node Crash (full host failure)

**Scenario**: The physical or virtual machine running one or more containers is terminated, loses power, or is evicted.

### What happens automatically

Same flow as a worker crash, for each worker that was running on the failed node. If the failed node held the leader key:

1. Leader key (`cluster:leader`) expires after `leaderLeaseTtlMs` (default 30 s).
2. All remaining nodes are attempting election every `leaderLeaseTtlMs`; the first to succeed emits `leadership:gained`, starts the dead-worker scanner, and picks up maintenance responsibilities.

**Maximum leader gap**: `leaderLeaseTtlMs` = 30 s with defaults.

### Sticky affinity redistribution

When a node holding sticky assignments (symbol → worker for indicators, accountId → worker for execution) disappears:

- The sticky (rendezvous hashing) balancer automatically computes the next-best worker from the surviving pool.
- Approximately `1/N` of sticky keys remap (where N was the pre-crash pool size).
- Indicator workers that receive a newly assigned symbol must warm their in-process cache — the first computation for that symbol may be slightly slower.

### No manual steps required.

---

## Leader Crash

**Scenario**: The node currently holding `cluster:leader` crashes or is killed.

### What happens automatically

| Time | Event |
|---|---|
| T+0 | Leader process exits. Lease renewal stops. |
| T+leaderLeaseTtlMs (default 30 s) | `cluster:leader` key expires. |
| T+next election attempt | First follower to run `SET cluster:leader <nodeId> NX PX <ttl>` wins. |
| T+win | New leader starts dead-worker scanner. Previous leader (if it was the crashed node) is cleaned up by the scanner in the next cycle. |

### During the leader gap

- Worker registration and heartbeat continue normally on all followers.
- Dead-worker scanning pauses until a new leader is elected. If workers crash during this window, they are cleaned up as soon as the new leader's scanner runs.
- Task routing continues unaffected (routing uses `WorkerDiscoveryService` which checks heartbeat keys directly, not the leader).

### If the crashed leader held distributed locks

Locks expire at their configured `ttlMs`. The next requester acquires normally.

### No manual steps required.

---

## Redis Primary Crash

**Scenario**: The Redis primary node becomes unavailable (crash, network isolation).

### With Redis Sentinel (recommended)

`docker-compose.cluster.yml` runs `redis-sentinel` monitoring the primary. Sentinel configuration:

```
sentinel monitor redis-primary redis-primary 6379 1
sentinel down-after-milliseconds redis-primary 5000
sentinel failover-timeout redis-primary 30000
```

| Time | Event |
|---|---|
| T+0 | Redis primary stops responding. |
| T+5 s | Sentinel marks primary as `sdown` (subjectively down). |
| T+5–30 s | Sentinel promotes the replica to primary. |
| T+promotion | ioredis client automatically reconnects to the new primary (Sentinel-aware client). |
| T+reconnect | Heartbeats, registry operations, and lock acquisitions resume. |

**During failover (~5–30 s)**:

- All Redis commands fail or queue. ioredis retries with exponential backoff.
- Heartbeat publishes fail silently (logged as warnings). Keys do not expire during this window — they were set with TTLs that outlast the failover window.
- Lock acquisitions queue up, waiting for Redis to return. Callers with `lockWaitMs < failoverTime` receive `Err(LockAcquisitionError)` and should retry at the application layer.

### Without Sentinel (development mode)

Redis becomes unavailable until restarted. All cluster operations fail. The platform continues processing tasks from in-memory queues already consumed but will not publish new tasks or acquire distributed locks.

**Recovery**: Restart Redis. All workers reconnect automatically. Workers re-register on the next heartbeat cycle.

### No manual steps required with Sentinel.

---

## Database Primary Crash

**Scenario**: PostgreSQL primary becomes unavailable.

### With Replication and Automatic Failover

`docker-compose.cluster.yml` runs a PostgreSQL replica. Failover is not automatic in the default setup — it requires a failover tool (Patroni, repmgr) or manual promotion.

#### Automatic failover (Patroni / repmgr)

If a failover orchestrator is deployed:

1. Replica is promoted to primary automatically.
2. Application reconnects via the VIP or connection pool that updates automatically.
3. Read replicas continue serving read-only queries during the window.

#### Manual failover (default setup)

```bash
# On the replica host
pg_ctl promote -D /var/lib/postgresql/data

# Update DATABASE_URL in environment to point to the new primary
DATABASE_URL=postgresql://user:pass@new-primary:5432/trading

# Restart API nodes to pick up new connection string
docker compose -f docker-compose.cluster.yml restart api
```

### During database unavailability

- Endpoints that read from or write to the database return `503 Service Unavailable`.
- In-memory and Redis-backed operations (heartbeat, task routing, lock acquisition, queue processing) continue normally.
- Strategies and risk checks that require position data from the database will fail gracefully and return errors to callers.

### Read-replica failure

Read replicas serve analytics and reporting queries. Primary handles writes. If the read replica fails:

- Write operations continue on the primary.
- Read-heavy analytics endpoints degrade (fall back to primary, or return 503 if the application layer enforces read-replica-only for those paths).
- No impact on trading operations.

---

## Network Partition

**Scenario**: The cluster splits into two groups that cannot communicate with each other. Example: nodes A, B, C can reach Redis but nodes D, E cannot.

### Leader side (can reach Redis)

- Nodes A, B, C continue normal operation.
- The current leader (if in A/B/C) renews its lease normally.
- Dead-worker scanner eventually detects D and E as dead (heartbeat keys expire) and deregisters them.
- Task routing excludes D and E automatically.

### Isolated side (cannot reach Redis)

- Nodes D and E cannot publish heartbeats, acquire locks, or consume from queues.
- Their heartbeat keys expire on the Redis side, causing them to be deregistered.
- If D or E was the leader, it loses the lease (cannot renew); the Redis-connected side elects a new leader.
- D and E should fail their health checks and be removed from the load balancer's upstream pool (nginx removes them on the next health probe).

### Split-brain prevention

Split-brain (two leaders simultaneously) is prevented by the Redis key:

- Only one node can hold `cluster:leader` at a time (Redis single-master guarantees).
- A network-isolated node cannot renew its key, so it loses the lease.
- The isolated node emits `leadership:lost` and stops acting as leader.

### Recovery after partition heals

1. Nodes D and E reconnect to Redis.
2. They re-register via `WorkerRegistryService.register()`.
3. Heartbeat keys are re-published; they become visible to the discovery service.
4. Task routing includes them again within one heartbeat interval.
5. They attempt leader election but fail (current leader holds the key).

### No manual steps required if network heals.

If the partition is permanent (node replacement), simply terminate the isolated containers and start new ones.

---

## Partial Degradation (DEGRADED status)

**Scenario**: A worker is alive but experiencing elevated error rates, memory pressure, or slow responses.

### Detection

`WorkerIdService.updateStatus(WorkerStatus.DEGRADED)` can be called by any internal health monitor. The updated status propagates to Redis via the next heartbeat's `updateFields()` call.

`WorkerDiscoveryService.getWorkersByCapability()` accepts an optional `statusFilter`. By default it includes `ACTIVE` and `DEGRADED` workers. Routing logic can optionally exclude `DEGRADED` workers for latency-sensitive paths.

### Automatic Weight Reduction

The `WeightedBalancer` and `LeastLoadedBalancer` use live CPU and task count metrics. A degraded worker with elevated CPU/task counts automatically receives fewer tasks — no explicit degraded-state handling needed.

### Manual Draining

To drain a worker without killing it (e.g. for maintenance):

```typescript
// Call on the node to be drained
workerIdService.updateStatus(WorkerStatus.STOPPING);
```

The `STOPPING` status causes `WorkerDiscoveryService.getWorkersByCapability()` to exclude the worker from routing decisions (only `ACTIVE` and `DEGRADED` are included by default). In-flight tasks complete naturally.

---

## Queue Message Failure and DLQ Recovery

**Scenario**: A queue message handler throws an exception or times out repeatedly.

### Automatic retry

`RedisQueueProvider` retries failed messages up to `maxRetries` times (configurable per queue). On each failure the message remains in the PEL (Pending Entry List) — it is not lost.

### Dead-letter queue promotion

After `maxRetries` failures, the message is moved to `{queue}:dlq`:

```
XADD {queue}:dlq * originalId {id} type {type} payload {json} error {msg} failedAt {ts}
```

### Inspecting the DLQ

```bash
# List failed messages
redis-cli XRANGE queue:indicator:dlq - + COUNT 20

# Count pending messages in DLQ
redis-cli XLEN queue:indicator:dlq
```

### Replaying DLQ messages

DLQ messages are standard stream entries. Replay by reading and re-publishing to the original queue:

```bash
# Read one DLQ entry
redis-cli XRANGE queue:indicator:dlq - + COUNT 1

# Re-publish to original queue (use the payload from the DLQ entry)
redis-cli XADD queue:indicator MAXLEN '~' 10000 '*' type indicator:candle payload '{"symbol":"BTC/USDT",...}'
```

Or implement a DLQ drain script that reads all entries, filters by error type, and re-queues fixable ones.

### Clearing the DLQ

```bash
# Delete all DLQ entries (after investigation)
redis-cli DEL queue:indicator:dlq
```

---

## Distributed Lock Expiry

**Scenario**: A node holds a distributed lock and then crashes before releasing it.

### Automatic recovery

Distributed locks are set with `PX {ttlMs}`. If the holder crashes:

1. Lock key expires automatically after `ttlMs` (default 30 s).
2. The next caller acquires the lock normally.
3. No orphaned locks. No manual intervention.

### Lock TTL sizing

Set `ttlMs` to be slightly longer than the expected critical section duration, with headroom for GC pauses:

```typescript
// Critical section takes ≤500 ms → use 2000 ms TTL
await lockProvider.withLock('order:123', handler, { ttlMs: 2_000 });
```

If the critical section is long-running (e.g. backtest replay), use a longer TTL and implement lock renewal within the operation:

```typescript
// Renew the lock every 10 s during a long operation
const lock = await lockProvider.acquire('replay:abc', { ttlMs: 15_000 });
const renewalInterval = setInterval(() => lockProvider.renew('replay:abc', { ttlMs: 15_000 }), 10_000);
try {
  await runLongOperation();
} finally {
  clearInterval(renewalInterval);
  await lockProvider.release('replay:abc');
}
```

### Detecting lock contention

```bash
# List all held locks
redis-cli --scan --pattern 'cluster:lock:*'

# Check TTL on a specific lock
redis-cli TTL cluster:lock:order:123
```

High contention (many callers waiting) indicates either:
- Critical sections are too slow (optimize the guarded operation)
- TTL is too long (reduce to minimum viable)
- Lock granularity is too coarse (split into per-resource locks)

---

## Monitoring and Alerting During Failures

### Health Endpoint

```
GET /health
```

Returns:
- `status: 'healthy'` — all workers alive, leader elected
- `status: 'degraded'` — no leader elected (maintenance tasks paused)
- `status: 'unhealthy'` — zero workers registered

Integrate with your load balancer health checks to remove unhealthy nodes from the upstream pool automatically.

### Key Redis Indicators

```bash
# Worker count
redis-cli SCARD cluster:worker-index

# Leader present
redis-cli EXISTS cluster:leader

# Heartbeat TTLs (should all be > 0)
for key in $(redis-cli --scan --pattern 'cluster:hb:*'); do
  echo "$key TTL=$(redis-cli TTL $key)"
done

# Queue depths
redis-cli XLEN queue:indicator
redis-cli XLEN queue:strategy
redis-cli XLEN queue:backtest
```

### Alert Thresholds (suggested)

| Condition | Alert Level | Action |
|---|---|---|
| `SCARD cluster:worker-index` = 0 | Critical | No workers alive — platform cannot process tasks |
| `EXISTS cluster:leader` = 0 | Warning | No leader — dead-worker scanning paused |
| `XLEN queue:{name}` > 10,000 | Warning | Queue backlog growing — add workers for that capability |
| `XLEN queue:{name}:dlq` > 0 | Warning | Messages failing — investigate DLQ |
| Worker CPU > 90% sustained | Warning | Add workers for that capability |
| `/health` status = `unhealthy` | Critical | Remove node from load balancer |

### Log Markers for Failures

```
level=warn  msg="dead worker detected and removed"   nodeId=... 
level=warn  msg="heartbeat publish failed"            nodeId=... error=...
level=info  msg="leadership gained"                   nodeId=...
level=info  msg="leadership lost — renewal failed"   nodeId=...
level=warn  msg="lock acquisition timeout"            resource=... waitMs=...
level=error msg="message moved to DLQ"               queue=... messageId=... error=...
```

Filter these in your log aggregator (Loki, CloudWatch, Datadog) for automated alerting.
