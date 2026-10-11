# Performance Review — Trading Platform

**Date**: 2026-08-30  
**Scope**: CPU, RAM, Disk, Redis, Database, WebSocket, Network measurement baselines and recommendations

---

## 1. Executive Summary

This document establishes performance baselines, identifies bottlenecks, and records optimizations applied or recommended for the production trading platform. All measurements are derived from code analysis and profiling-compatible instrumentation; live load test results should be filled in from actual infrastructure measurements.

---

## 2. Architecture Performance Profile

### 2.1 Request Path (Critical Path)

```
HTTP request → CorrelationIdMiddleware → RequestLoggingMiddleware
  → Route handler → Service layer → Kysely ORM → PostgreSQL
  → Response (+ metrics record)
```

Typical hot path for the trading signal pipeline (not HTTP):

```
Exchange WebSocket feed
  → MarketDataService (event parse, normalize)
  → StrategyScheduler (per-symbol evaluation)
  → RiskEngine (position/drawdown checks)
  → ExecutionEngine (order build + retry)
  → Exchange REST API (order submit)
  → StreamPublisher (Redis stream write)
```

### 2.2 Threading Model

Node.js single-threaded event loop. CPU-bound work (backtesting, Monte Carlo, indicator math) must be moved off the event loop via worker threads or process isolation. **Current state**: these are in-process — acceptable for low concurrency but will block the event loop under high symbol counts.

---

## 3. CPU Analysis

### 3.1 Hot Paths (Code Analysis)

| Component | Operation | Complexity | Risk |
|-----------|-----------|------------|------|
| StrategyScheduler | Per-symbol heartbeat | O(symbols × strategies) | HIGH at >1000 symbols |
| IndicatorService | Rolling window math (EMA, ATR, RSI) | O(window_size) per tick | Moderate |
| BacktestEngine | Full OHLCV replay | O(candles × strategies) | HIGH — run async/worker |
| MonteCarloEngine | 10k+ simulation paths | O(paths × periods) | HIGH — run async/worker |
| RiskEngine | Per-decision evaluation | O(positions + violations) | Low |

### 3.2 Recommendations

1. **Move backtesting and Monte Carlo to worker threads** (`node:worker_threads`). These are currently in-process and will block the event loop when triggered with large datasets.
2. **Batch indicator updates** — instead of computing per-tick per-symbol, batch by symbol group when multiple symbols update simultaneously.
3. **Profile with `--cpu-prof`** under load test scenarios (see §7 load test targets).

---

## 4. Memory Analysis

### 4.1 Heap Profile

| Component | Memory Pattern | Risk |
|-----------|----------------|------|
| Redis stream consumer | Event queue buffering | Bounded by `XREADGROUP COUNT` limit |
| Order tracker (`OrderTrackerService`) | In-memory map of open orders | Grows with open order count — bounded by `maxOpenOrders` risk config |
| Winston daily-rotate logger | Log buffer | Bounded by `maxSize` config |
| WebSocket connection manager | Per-connection state + event listeners | Scales with subscribed symbols |
| Position service | In-memory position map | Bounded by `maxPositionsPerSymbol` × symbols |

### 4.2 Known Leak Points Addressed in M30

- **ExecutionEngineService event subscription** was not cleaned up on module destroy. Fixed: `onModuleDestroy()` now calls `subscription.unsubscribe()`.
- **RedisClientService** — single `connected` flag shared between two clients caused inconsistent state; not a memory leak, but a correctness issue.

### 4.3 Heap Growth Indicators

Run `GET /diagnostics/runtime` (authenticated) to observe:
- `heapUsed / heapTotal` — should be < 80% under steady-state load
- `external` — V8 external memory (Buffers, native addons)
- `arrayBuffers` — should remain stable, not grow monotonically

### 4.4 GC Pressure Points

- Winston logging under high throughput creates many short-lived string objects
- Redis stream message deserialization (JSON.parse per message)
- `randomUUID()` (crypto-backed) — negligible overhead

---

## 5. Database (PostgreSQL / Kysely)

### 5.1 Query Patterns

| Query Type | Pattern | Indexed |
|-----------|---------|---------|
| Order lookup by exchangeOrderId | Point lookup | Must be indexed — verify |
| Position history by symbol + timerange | Range scan | Composite index (symbol, timestamp) required |
| Backtest results by sessionId | Point lookup | sessionId primary key |
| Trade log by strategyId | Range scan | Index on strategyId + timestamp |

### 5.2 Connection Pool

- Default pg pool: 10 connections
- Under 1000 simultaneous open positions, each position update hits the database
- Recommended: pool size = (core_count × 2) + effective_spindle_count; verify with `pg_stat_activity`

### 5.3 Recommendations

1. Verify `EXPLAIN ANALYZE` on position update queries under 1000-symbol load.
2. Add `created_at` / `updated_at` indexes if not present on orders and positions tables.
3. Use prepared statements (Kysely does this by default via pg parameterized queries).
4. Enable `pg_stat_statements` in production to identify slow queries.

---

## 6. Redis

### 6.1 Stream Backlog Risk

Redis streams accumulate indefinitely without `MAXLEN` or periodic `XTRIM`. The platform uses `XADD` with fixed stream names (`EXECUTION_REPORT`, `EXECUTION_AUDIT`, `ORDER_UPDATE`). Verify that `StreamPublisherService` sets `MAXLEN` on each `XADD`.

**Action**: Add `XADD <stream> MAXLEN ~ 10000 * <fields>` to all stream publishes.

### 6.2 Memory Sizing

| Dataset | Estimated Size |
|---------|----------------|
| 1000 symbols × 5 sorted-set entries | ~50 KB |
| 100 open orders tracked | ~10 KB |
| 1000 messages in execution stream backlog | ~500 KB |
| 1-day position history snapshots | ~5 MB |

Redis `INFO memory` should be monitored via `GET /diagnostics` (authenticated). Alert threshold: 80% of `maxmemory`.

### 6.3 Key Expiry Strategy

All volatile keys (session data, rate-limit counters) must have TTLs. Verify with `SCAN` + `TTL` sampling in production.

---

## 7. WebSocket (Exchange Feeds)

### 7.1 Throughput

| Exchange | Symbols | Message Rate (est.) |
|----------|---------|---------------------|
| Binance Futures | 100 | ~1000 msg/s |
| Binance Futures | 1000 | ~10,000 msg/s |

At 10,000 msg/s, Node.js I/O overhead becomes significant. Use `ws` binary frames, avoid JSON.parse on hot path (prefer binary protocol where available).

### 7.2 Reconnection

`WsReconnectManager` implements exponential backoff. Verify `maxRetries` configuration is not set to 0 (which would disable reconnection entirely in the Redis client's pattern too).

### 7.3 Subscription Management

`WsSubscriptionManager` tracks per-symbol handlers. Verify `off()` is called when a strategy stops watching a symbol to prevent listener accumulation.

---

## 8. Network

### 8.1 Exchange REST Latency Budget

| Operation | Target | Alert |
|-----------|--------|-------|
| Order submission | < 200ms | > 500ms |
| Balance query | < 100ms | > 300ms |
| Order status | < 100ms | > 300ms |

Circuit breaker in `BinanceRestClient` opens after 5 consecutive failures within 30s.

### 8.2 Internal Service Latency

`LatencyMonitorService` records five checkpoints per execution:
1. Validation
2. Route selection
3. Order build
4. Exchange request sent
5. Exchange response received + fill processing

Total target: < 1 RTT to exchange + 50ms platform overhead.

---

## 9. Load Test Targets

| Scenario | Symbols | Expected TPS | Heap Target | CPU Target |
|----------|---------|-------------|-------------|------------|
| Baseline | 10 | 10 events/s | < 200 MB | < 10% |
| Standard | 100 | 100 events/s | < 400 MB | < 30% |
| High | 1000 | 1000 events/s | < 800 MB | < 60% |
| Extreme | 10000 | 10000 events/s | < 2 GB | < 80% |

At 10,000 symbols, the current architecture requires worker thread isolation for strategy evaluation. Without it, the event loop will saturate.

---

## 10. Stress & Chaos Test Checklist

| Scenario | Expected Behavior | Recovery SLA |
|----------|------------------|--------------|
| Exchange disconnect | WsReconnectManager triggers; orders in-flight are tracked | < 30s reconnect |
| Redis restart | `enableOfflineQueue: true` — commands queue; drain on reconnect | < 60s |
| DB restart | pg pool reconnects; in-flight queries fail with retry | < 30s |
| Server restart | SIGTERM → NestJS graceful shutdown; Redis streams preserve messages | < 5s startup |
| Packet loss 20% | Retries + circuit breaker handle transient failures | Transparent |
| Latency spike 2s | Circuit breaker opens if threshold exceeded; alerts fire | < 5s detection |

---

## 11. Monitoring Thresholds (Configured)

From `MonitoringConfig`:

| Metric | Warning Threshold | Alert Threshold |
|--------|-----------------|-----------------|
| Request latency | 100ms | Configurable via `MONITORING_LATENCY_WARN_MS` |
| Error rate | 5% | Configurable via `MONITORING_ERROR_RATE_WARN_PERCENT` |
| Memory usage | 80% | Configurable via `MONITORING_MEMORY_WARN_PERCENT` |
| CPU usage | 80% | Configurable via `MONITORING_CPU_WARN_PERCENT` |

These are hot-reloadable via `SIGHUP` without a process restart.

---

## 12. Performance Recommendations (Prioritized)

| Priority | Item | Impact |
|----------|------|--------|
| P0 | Add `MAXLEN` to all Redis `XADD` calls | Prevents stream OOM |
| P0 | Move backtesting to worker threads | Prevents event loop stalls during backtest |
| P1 | Move Monte Carlo to worker threads | Same |
| P1 | Verify DB indexes on positions, orders | Order lookup latency |
| P2 | Batch indicator updates at high symbol count | CPU reduction at 1000+ symbols |
| P3 | Add `pg_stat_statements` monitoring | Query performance visibility |
| P3 | Profile heap under sustained 1000-symbol load | Memory growth characterization |
