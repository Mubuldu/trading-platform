# Monitoring & Observability — Architecture

## Overview

The platform observability stack is built in four layers:

```
┌─────────────────────────────────────────────────────────┐
│                   HTTP Endpoints                        │
│  /live  /ready  /health   /diagnostics                  │
└─────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────────────────────────────────────┐
│              Services (core/*)                          │
│  HealthService  TracingService  DiagnosticsService      │
└─────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────────────────────────────────────┐
│              Metrics Store (IMetrics)                   │
│  InMemoryMetricsService  RuntimeStatsCollector          │
└─────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────────────────────────────────────┐
│              Request Context (AsyncLocalStorage)        │
│  correlationId  requestId  (per-request, propagated)    │
└─────────────────────────────────────────────────────────┘
```

---

## Health Endpoints

### `GET /api/v1/health/live` — Liveness

Used by: Kubernetes liveness probe, Docker HEALTHCHECK.

Returns `200` immediately if the process is responding. Checks **nothing external**.
If this probe fails, Kubernetes restarts the pod.

```json
{
  "status": "alive",
  "pid": 12345,
  "uptimeSeconds": 3600.5,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### `GET /api/v1/health/ready` — Readiness

Used by: Kubernetes readiness probe, load balancer health checks.

Runs all registered infrastructure health checks via `HealthCheckRegistry`.

| Infrastructure Status | HTTP | Response Status |
|-----------------------|------|-----------------|
| All healthy           | 200  | `ready`         |
| Any degraded          | 200  | `ready`         |
| Any unhealthy         | 503  | `not-ready`     |

Returns `ready` for degraded dependencies because the service can still serve traffic
with reduced functionality. The `not-ready` (503) response removes the pod from the
load balancer rotation.

```json
{
  "status": "ready",
  "checks": {
    "database": { "status": "healthy", "latencyMs": 2 },
    "cache":    { "status": "healthy", "latencyMs": 1 }
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### `GET /api/v1/health` — Full Health

Used by: monitoring dashboards, alerting systems (future).

Always returns `200`. Status is in the response body. Includes:
- Application version, environment, and uptime
- Memory usage (RSS, heap used/total, external)
- Infrastructure check results
- Key runtime metrics snapshot (event loop lag, request stats, GC stats)

---

## Metrics Catalog

All metric names are defined in `src/core/metrics/metrics-catalog.ts`.

### Process Metrics (collected every 15s by RuntimeStatsCollector)

| Metric | Type | Unit | Description |
|--------|------|------|-------------|
| `process.uptime_seconds` | gauge | seconds | Process uptime |
| `process.memory.rss_bytes` | gauge | bytes | Resident set size |
| `process.memory.heap_used_bytes` | gauge | bytes | V8 heap in use |
| `process.memory.heap_total_bytes` | gauge | bytes | V8 heap total |
| `process.memory.external_bytes` | gauge | bytes | External memory (Buffers) |
| `process.cpu.user_ms` | gauge | ms | CPU user time delta |
| `process.cpu.system_ms` | gauge | ms | CPU system time delta |
| `process.cpu.user_percent` | gauge | % | CPU user % since last sample |
| `process.cpu.system_percent` | gauge | % | CPU system % since last sample |

### V8 Heap Metrics

| Metric | Type | Unit | Description |
|--------|------|------|-------------|
| `v8.heap.used_bytes` | gauge | bytes | Used heap size |
| `v8.heap.total_bytes` | gauge | bytes | Total heap size |
| `v8.heap.limit_bytes` | gauge | bytes | Heap size limit |
| `v8.heap.available_bytes` | gauge | bytes | Available heap size |
| `v8.malloced_memory_bytes` | gauge | bytes | Malloced memory |

### Garbage Collection Metrics

| Metric | Type | Tags | Description |
|--------|------|------|-------------|
| `gc.duration_ms` | timing | `kind` | GC pause duration histogram |
| `gc.count` | counter | `kind` | GC invocation count |

`kind` tag values: `1` (minor), `4` (major), `2` (incremental), `8` (weak cb).

### Event Loop

| Metric | Type | Unit | Description |
|--------|------|------|-------------|
| `event_loop.lag_ms` | gauge | ms | Event loop delay beyond 1s schedule |

### HTTP Metrics

| Metric | Type | Tags | Description |
|--------|------|------|-------------|
| `http.request.duration_ms` | timing | `method`, `route`, `status` | Request duration |
| `http.requests.total` | counter | `method`, `status` | Total request count |
| `http.requests.active` | gauge | — | In-flight request count |

### Database Metrics (emitted by infrastructure code)

| Metric | Type | Unit | Description |
|--------|------|------|-------------|
| `db.query.duration_ms` | timing | ms | Query execution time |
| `db.connections.active` | gauge | — | Active pool connections |
| `db.latency_ms` | timing | ms | Ping latency |

### Redis Metrics

| Metric | Type | Unit | Description |
|--------|------|------|-------------|
| `redis.latency_ms` | timing | ms | Command round-trip time |
| `redis.commands.total` | counter | — | Command invocation count |

### WebSocket Metrics

| Metric | Type | Tags | Description |
|--------|------|------|-------------|
| `ws.latency_ms` | timing | — | Round-trip latency |
| `ws.messages.received` | counter | — | Total messages received |
| `ws.connections.active` | gauge | — | Active WebSocket connections |

### Queue / Stream Metrics

| Metric | Type | Tags | Description |
|--------|------|------|-------------|
| `queue.length` | gauge | — | Pending items in queue |
| `stream.consumer.lag` | gauge | — | Consumer lag behind producer |

---

## Metrics Architecture

### IMetrics Interface

All platform code emits metrics via the `IMetrics` interface (injected via `METRICS_TOKEN`).
The interface has five operations:

```typescript
increment(metric, value?, tags?)  // counter: add
decrement(metric, value?, tags?)  // counter: subtract
gauge(metric, value, tags?)       // set point-in-time value
histogram(metric, value, tags?)   // record a distribution sample
timing(metric, durationMs, tags?) // histogram for time values
startTimer(metric, tags?)         // returns stop() → records elapsed
```

### Current Implementation: InMemoryMetricsService

Stores metrics in memory using a ring-buffer design:
- **Counters**: `Map<string, number>` — O(1) read/write
- **Gauges**: `Map<string, number>` — O(1) read/write
- **Histograms/Timings**: `Float64Array` ring buffer, capacity 1024 samples per metric key. Percentiles (p50, p75, p95, p99) are computed from the ring at read time via sort + linear interpolation.

Memory bound: 1024 samples × 8 bytes × N metrics. For 50 timing metrics: ~400 KB total.

### Prometheus Migration Path

To add Prometheus:
1. Create `PrometheusMetricsService implements IMetrics` using `prom-client`.
2. Change `MetricsModule` to `useClass: PrometheusMetricsService`.
3. Add `GET /api/v1/metrics` endpoint that returns `register.metrics()`.

No business code changes are required.

---

## Tracing

### Correlation IDs

Every HTTP request carries two IDs propagated via AsyncLocalStorage:

| ID | Source | Scope | Purpose |
|----|--------|-------|---------|
| `correlationId` | Incoming header or generated | Distributed | Cross-service trace ID |
| `requestId` | Always generated fresh | Local | Per-request deduplication |

Both IDs appear in every log line and in the response headers:
- `x-correlation-id`: the correlationId
- `x-request-id`: the requestId

### Span Tracking

`TracingService` provides lightweight in-process span tracking:

```typescript
const span = tracing.startSpan('order.validate', { symbol: 'BTC' });
try {
  // ... work ...
  tracing.endSpan(span.spanId, 'ok');
} catch (e) {
  tracing.endSpan(span.spanId, 'error');
  throw e;
}
```

Spans carry: `spanId`, `traceId` (= correlationId), `operationName`, `startTimeMs`, `durationMs`, `status`, `tags`.

The last 256 completed spans are retained in memory for diagnostics inspection via `GET /api/v1/diagnostics`.

### OpenTelemetry Migration Path

Replace `TracingService` with an OtelTracingService that wraps an OpenTelemetry `TracerProvider`. Register it under `TRACING_TOKEN`. All callers are unchanged.

---

## Log Correlation

Every log line emitted by `AppLoggerService` contains:

```json
{
  "timestamp": "2024-01-01T00:00:00.000Z",
  "level": "info",
  "service": "trading-platform",
  "context": "OrderService",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "requestId": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  "message": "Order placed successfully"
}
```

To correlate a request end-to-end:
1. Note the `x-correlation-id` response header from any request.
2. Search logs: `correlationId = "<value>"`.

---

## Diagnostics

### `GET /api/v1/diagnostics`

Returns a full runtime snapshot:
- **runtime**: PID, Node.js version, platform, arch, uptime, memory, V8 heap, CPU, active handles
- **metrics**: Full `InMemoryMetricsService.getSnapshot()` — all counters, gauges, histograms, timings
- **activeSpans**: Spans currently in-flight across the service
- **recentSpans**: Last 50 completed spans

### `GET /api/v1/diagnostics/runtime`

Process stats only (lighter weight).

### `POST /api/v1/diagnostics/heap-snapshot`

Writes a V8 heap snapshot to the OS temp directory. Returns the file path.

**Disabled in production** — taking a heap snapshot causes a ~1 second GC pause that
will impact request latency. Use only in development or staging with low traffic.

---

## Performance Overhead

| Component | Overhead |
|-----------|----------|
| Correlation ID middleware | < 1 µs per request (UUID generation) |
| Request metrics recording | < 1 µs per request (Map write) |
| RuntimeStatsCollector | 1ms burst every 15s (configurable) |
| GC observer | Zero overhead on non-GC paths |
| Event loop lag timer | One `setTimeout` per second, unref'd |
| TracingService.startSpan | < 1 µs (Map write + UUID) |
| InMemoryMetricsService.timing | < 1 µs (Float64Array write) |

The `NoopMetricsService` remains available for unit tests and minimal deploys where
even the ring-buffer overhead is undesirable.

---

## Configuration

All monitoring behaviour is controlled via `MonitoringConfig` (env vars):

| Variable | Default | Description |
|----------|---------|-------------|
| `METRICS_ENABLED` | `true` | Enable/disable metric collection |
| `METRICS_PREFIX` | `trading_platform` | Metric name prefix (for future Prometheus) |
| `METRICS_COLLECTION_INTERVAL_MS` | `15000` | RuntimeStatsCollector interval |
| `MONITORING_LATENCY_WARN_MS` | `100` | Latency warning threshold (future alerts) |
| `MONITORING_ERROR_RATE_WARN_PERCENT` | `5` | Error rate warning threshold |
| `MONITORING_MEMORY_WARN_PERCENT` | `80` | Memory usage warning threshold |
| `MONITORING_CPU_WARN_PERCENT` | `80` | CPU usage warning threshold |
