# Operations Manual — Trading Platform

**Date**: 2026-08-30  
**Version**: 1.0  
**Audience**: SRE, DevOps, On-call engineers

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Trading Platform                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ Strategy │  │  Risk    │  │Execution │  │ Reporting │  │
│  │ Engine   │→ │ Engine   │→ │ Engine   │→ │ Engine    │  │
│  └──────────┘  └──────────┘  └──────────┘  └───────────┘  │
│       ↑                              ↓                       │
│  ┌──────────────┐           ┌──────────────┐                │
│  │ Market Data  │           │ Redis Streams│                │
│  │ (WebSocket)  │           │  (pub/sub)   │                │
│  └──────────────┘           └──────────────┘                │
│       ↑                              ↓                       │
│  ┌──────────┐               ┌──────────────┐                │
│  │ Exchange │               │  PostgreSQL   │                │
│  │ Adapters │               │  (Orders/Pos) │                │
│  └──────────┘               └──────────────┘                │
└─────────────────────────────────────────────────────────────┘

HTTP API: /api/v1/* (Helmet, rate-limiting, CORS, JWT + API key guards)
Internal: /api/v1/health, /api/v1/diagnostics (API key required)
```

---

## 2. Environment Variables Reference

### 2.1 Required (no default)

| Variable | Description |
|----------|-------------|
| `APP_NAME` | Application name (appears in logs) |
| `APP_PORT` | HTTP port (e.g. `3000`) |
| `APP_VERSION` | Semantic version (e.g. `1.0.0`) |
| `NODE_ENV` | `development` / `test` / `staging` / `production` |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection URL (e.g. `redis://localhost:6379`) |
| `API_KEY_SECRET` | Secret for `x-api-key` header on internal endpoints |

### 2.2 Optional (have defaults)

| Variable | Default | Description |
|----------|---------|-------------|
| `SWAGGER_ENABLED` | `false` | Enable Swagger UI (auto-disabled in production) |
| `CORS_ORIGINS` | `""` (deny all) | Comma-separated allowed CORS origins |
| `REDIS_KEY_PREFIX` | `tp:` | Prefix for all Redis keys |
| `REDIS_PASSWORD` | `""` | Redis AUTH password |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

### 2.3 Hot-Reloadable (SIGHUP triggers reload)

| Variable | Domain | Default |
|----------|--------|---------|
| `RISK_ENABLED` | risk | `true` |
| `RISK_MAX_POSITION_SIZE_USD` | risk | `100000` |
| `RISK_MAX_DRAWDOWN_PERCENT` | risk | `10` |
| `RISK_MAX_DAILY_LOSS_USD` | risk | `5000` |
| `RISK_MAX_ORDER_SIZE_USD` | risk | `10000` |
| `RISK_MAX_LEVERAGE` | risk | `3` |
| `RISK_MAX_OPEN_ORDERS` | risk | `50` |
| `RISK_MAX_CONCENTRATION_PERCENT` | risk | `30` |
| `STRATEGY_ENABLED_IDS` | strategy | `""` |
| `STRATEGY_DEFAULT_SYMBOL` | strategy | `BTC/USDT` |
| `STRATEGY_MAX_CONCURRENT` | strategy | `5` |
| `MONITORING_LATENCY_WARN_MS` | monitoring | `100` |
| `MONITORING_ERROR_RATE_WARN_PERCENT` | monitoring | `5` |
| `MONITORING_MEMORY_WARN_PERCENT` | monitoring | `80` |
| `MONITORING_CPU_WARN_PERCENT` | monitoring | `80` |
| `ALERTS_ENABLED` | alerts | `true` |
| `ALERTS_COOLDOWN_SECONDS` | alerts | `300` |

---

## 3. Deployment

### 3.1 Container Build

```bash
# Build production image
docker build -t trading-platform:$(git rev-parse --short HEAD) \
  --target production \
  --build-arg NODE_ENV=production \
  .

# Tag as latest
docker tag trading-platform:<sha> trading-platform:latest
```

### 3.2 Running in Production

```bash
docker run -d \
  --name trading-platform \
  --restart unless-stopped \
  --env-file .env.production \
  -p 3000:3000 \
  --memory="2g" \
  --cpus="2.0" \
  trading-platform:latest
```

### 3.3 Health Check (Docker)

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -sf http://localhost:$APP_PORT/api/v1/health/live || exit 1
```

### 3.4 Zero-Downtime Deployment

1. Build and push new image
2. Start new container alongside existing
3. Wait for new container to pass health check (liveness + readiness)
4. Route traffic to new container
5. Drain existing container (SIGTERM → graceful shutdown)

---

## 4. Startup & Shutdown

### 4.1 Startup Sequence

The platform bootstrap (`src/main.ts`) follows this order:
1. Create NestJS application
2. Configure logger
3. Apply Helmet security headers
4. Set global prefix (`api`) and URI versioning
5. Apply body size limits (1 MB JSON, 512 KB URL-encoded)
6. Apply global validation pipe, exception filter, and class serializer
7. Configure CORS
8. Set up Swagger (non-production only)
9. Enable graceful shutdown hooks
10. Start listening on configured port

**Bootstrap log to confirm**:
```
Trading Platform v<version> running on port <port> [<environment>]
Health endpoint: http://localhost:<port>/api/v1/health
```

### 4.2 Graceful Shutdown

Send SIGTERM or SIGINT. The platform will:
1. Stop accepting new HTTP connections
2. Drain in-flight requests
3. Call `onModuleDestroy()` on all modules (closes Redis, DB pool, event subscriptions)
4. Exit with code 0

**Typical shutdown time**: < 5 seconds.

### 4.3 Force Reload (without restart)

```bash
# Reload hot-reloadable config domains (risk, strategy, monitoring, alerts)
docker kill --signal HUP trading-platform

# Confirm in logs
docker logs --tail 5 trading-platform | grep "hot-reloaded"
```

---

## 5. Health & Monitoring Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /api/v1/health` | None | Summary health (all components) |
| `GET /api/v1/health/live` | None | Liveness: process is alive |
| `GET /api/v1/health/ready` | None | Readiness: all dependencies available |
| `GET /api/v1/diagnostics` | x-api-key | Full runtime report |
| `GET /api/v1/diagnostics/runtime` | x-api-key | PID, memory, heap, CPU |
| `POST /api/v1/diagnostics/heap-snapshot` | x-api-key | V8 heap snapshot (non-production) |

### 5.1 Health Check Response Codes

- `200 OK` — healthy / live / ready
- `503 Service Unavailable` — not ready (dependency unavailable)
- `401 Unauthorized` — missing or invalid API key on diagnostics endpoints

### 5.2 Prometheus / Metrics

If Prometheus is configured, metrics are emitted via `InMemoryMetricsService` and scraped at the configured interval (`METRICS_COLLECTION_INTERVAL_MS`, default 15s).

---

## 6. Log Management

### 6.1 Log Format

All logs are structured JSON (Winston). Key fields:

```json
{
  "level": "info",
  "message": "Order submitted successfully",
  "context": "ExecutionEngineService",
  "correlationId": "a1b2-c3d4-...",
  "timestamp": "2026-08-30T10:00:00.000Z",
  "symbol": "BTC/USDT",
  "exchangeOrderId": "12345678"
}
```

### 6.2 Log Levels

| Level | When Used |
|-------|-----------|
| `debug` | Low-level diagnostic data (never enabled by default in production) |
| `info` | Normal significant events (order placed, connection established) |
| `warn` | Unexpected but recoverable (reconnecting, config reload rejected) |
| `error` | Failures requiring attention (order submission failed, stream publish error) |
| `critical` | System integrity compromised (data corruption, OOM imminent) |

### 6.3 Log Rotation

Winston `daily-rotate-file` is configured. Verify:
- `maxSize` is set (e.g., `20m` per file)
- `maxFiles` is set (e.g., `14d` for 14-day retention)
- Log directory is on a volume with adequate space

### 6.4 Sensitive Field Masking

`AppLoggerService` uses `SensitiveFieldSanitizer` to mask fields like `apiKey`, `secretKey`, `password`, `authorization` in structured log entries before writing.

---

## 7. Redis Operations

### 7.1 Stream Management

```bash
# List all streams
redis-cli KEYS "tp:*:stream" 

# Check stream length
redis-cli XLEN tp:execution:report

# Check consumer groups
redis-cli XINFO GROUPS tp:execution:report

# Check pending messages (unacknowledged)
redis-cli XPENDING tp:execution:report <group> - + 10

# Trim a stream to last 10,000 messages
redis-cli XTRIM tp:execution:report MAXLEN 10000
```

### 7.2 Health Check

```bash
redis-cli -h $REDIS_HOST -p $REDIS_PORT ping
redis-cli -h $REDIS_HOST INFO memory | grep used_memory_human
redis-cli -h $REDIS_HOST INFO clients | grep connected_clients
```

### 7.3 Flush (DANGER — development only)

```bash
# Never run in production without authorization
redis-cli FLUSHDB
```

---

## 8. Database Operations

### 8.1 Connection Check

```bash
psql "$DATABASE_URL" -c "SELECT version(), pg_is_in_recovery(), now();"
```

### 8.2 Active Connections

```bash
psql "$DATABASE_URL" -c "
  SELECT count(*), state
  FROM pg_stat_activity
  WHERE datname = current_database()
  GROUP BY state;
"
```

### 8.3 Slow Query Monitor

```bash
psql "$DATABASE_URL" -c "
  SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state
  FROM pg_stat_activity
  WHERE (now() - pg_stat_activity.query_start) > interval '5 seconds'
    AND state != 'idle';
"
```

---

## 9. Risk Management Operations

### 9.1 Emergency Stop

To immediately halt all new trade submissions without restarting:

```bash
# Method 1: Hot reload (preferred — no restart)
# Update .env.<environment>:
echo "RISK_ENABLED=false" >> .env.production
docker kill --signal HUP trading-platform
docker logs --tail 5 trading-platform | grep "hot-reloaded"

# Method 2: If SIGHUP is unavailable
docker stop --time 30 trading-platform  # graceful SIGTERM
```

### 9.2 Adjusting Risk Limits (Hot)

```bash
# Edit .env.production
RISK_MAX_POSITION_SIZE_USD=50000
RISK_MAX_LEVERAGE=2
RISK_MAX_DAILY_LOSS_USD=2000

# Reload
docker kill --signal HUP trading-platform
```

Validation runs before applying the new values. If validation fails, the old values are retained and a warning is logged.

---

## 10. Security Operations

### 10.1 Rotating the API Key

The `API_KEY_SECRET` is used by `ApiKeyGuard` for `/diagnostics` endpoints.

1. Generate a new secret: `openssl rand -hex 32`
2. Update `.env.production`
3. **Full restart required** — this is not hot-reloadable
4. Update the secret in all monitoring tools that call the diagnostics endpoints

### 10.2 Rotating Exchange API Keys

Exchange API keys (`BINANCE_API_KEY`, etc.) are not hot-reloadable.

1. Generate new keys on the exchange
2. Set new IP allowlist on the exchange
3. Update `.env.production`
4. Rolling restart: bring up new container with new keys before stopping old one
5. Verify: new container connects to exchange successfully in logs

### 10.3 Rate Limit Tuning

Global rate limit: 200 req/60s per IP (set in `AppModule.ThrottlerModule`).

This is compile-time config, not hot-reloadable. To adjust:
1. Update `AppModule.ThrottlerModule.forRoot()` limit/ttl values
2. Rebuild and deploy

Per-route overrides can be added via `@Throttle()` decorator without touching global config.

---

## 11. Backup & Recovery

### 11.1 PostgreSQL Backup

```bash
# Full backup
pg_dump "$DATABASE_URL" -Fc -f trading-platform-$(date +%Y%m%d).dump

# Restore
pg_restore -d "$DATABASE_URL" trading-platform-<date>.dump
```

### 11.2 Redis Backup

- Enable AOF (Append-Only File) persistence in `redis.conf`: `appendonly yes`
- Enable RDB snapshots: `save 900 1` (every 15 min if ≥1 key changed)
- Test restore: `redis-server --appendonly yes --appendfilename dump.aof`

### 11.3 Recovery Time Objectives

| Scenario | RTO | RPO |
|----------|-----|-----|
| Process crash (data intact) | < 2 min | 0 (Redis + DB intact) |
| Redis restart (AOF enabled) | < 30 sec | 0 (AOF replay) |
| DB failover to replica | < 5 min | < 30 sec (replica lag) |
| DB restore from backup | < 60 min | Since last backup |

---

## 12. Runbook Index

| Scenario | Section |
|----------|---------|
| Exchange feed disconnected | See incident-recovery.md §3.1 |
| Redis unavailable | See incident-recovery.md §3.2 |
| Database unavailable | See incident-recovery.md §3.3 |
| Platform crash | See incident-recovery.md §3.4 |
| Graceful restart | See incident-recovery.md §3.5 |
| Order reconciliation | See incident-recovery.md §3.6 |
| Data integrity check | See incident-recovery.md §3.7 |
| Hot config reload | See incident-recovery.md §3.8 |

---

## 13. Common Mistakes to Avoid

| Don't | Do Instead |
|-------|-----------|
| `redis-cli FLUSHDB` in production | Trim specific streams: `XTRIM` |
| `docker kill -9 trading-platform` | `docker stop --time 30 trading-platform` (SIGTERM → graceful) |
| Edit `.env.production` while platform is running and expect immediate effect for non-hot-reloadable fields | Restart the platform after changing non-hot-reloadable vars |
| Call `/diagnostics` without the `x-api-key` header | Include `x-api-key: $API_KEY_SECRET` |
| Deploy a new version without checking `/health/ready` first | Wait for `200 OK` from `/health/ready` before routing traffic |
| Trigger heap snapshot in production | Only trigger in staging; heap snapshot causes ~1s GC pause |
