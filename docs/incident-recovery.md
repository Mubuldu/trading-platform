# Incident Recovery — Trading Platform

**Date**: 2026-08-30  
**Version**: 1.0  
**Audience**: SRE, On-call engineers, Platform team

---

## 1. Severity Levels

| Level | Definition | Response Time | Escalation |
|-------|-----------|--------------|------------|
| P0 — Critical | Active financial loss; orders mis-executed; data corrupted | Immediate | All senior engineers + management |
| P1 — High | Platform offline; exchange feed down; trade submission failing | < 5 min | On-call + platform lead |
| P2 — Medium | Degraded performance; one exchange down; monitoring gaps | < 30 min | On-call |
| P3 — Low | Non-critical alerting; minor data inconsistency | < 4 hours | Next working day |

---

## 2. First Response Checklist

When paged, before doing anything else:

```bash
# 1. Check platform liveness
curl -sf http://<host>/api/v1/health

# 2. Check readiness (all dependencies)
curl -sf http://<host>/api/v1/health/ready

# 3. Check runtime stats (requires API key)
curl -H "x-api-key: $API_KEY_SECRET" http://<host>/api/v1/diagnostics/runtime

# 4. Check recent logs
docker logs --tail 200 trading-platform 2>&1 | grep -E 'ERROR|CRITICAL'

# 5. Check Redis
redis-cli -h $REDIS_HOST ping

# 6. Check database
psql $DATABASE_URL -c "SELECT 1"
```

---

## 3. Incident Runbooks

### 3.1 Exchange Feed Disconnected

**Symptoms**:
- No new market data events in the last 30 seconds
- Alert: `Redis [subscriber] connection closed` or `[exchange] feed disconnected`
- Strategy decisions halted

**Recovery steps**:

1. Check WebSocket reconnect status in logs:
   ```
   grep "reconnecting" <log> | tail -20
   ```
2. If reconnecting indefinitely (> 5 minutes), check exchange API status pages:
   - Binance: https://www.binance.com/en/status
   - Exchange maintenance windows are common at UTC 00:00
3. If exchange is up but platform is stuck, restart the WebSocket connection via:
   ```bash
   # Trigger SIGHUP to reload connection config (does not restart the process)
   docker kill --signal HUP trading-platform
   
   # If still stuck, rolling restart (graceful shutdown preserves in-flight orders)
   docker restart trading-platform
   ```
4. After reconnect, verify market data is flowing:
   ```bash
   redis-cli XLEN MARKET_DATA_STREAM
   # Should be incrementing
   ```

**SLA**: < 30 seconds automatic reconnect (WsReconnectManager exponential backoff).

---

### 3.2 Redis Unavailable

**Symptoms**:
- `Redis [primary] connection closed` / `Redis [subscriber] connection closed`
- `GET /health/ready` returns unhealthy
- Commands queued but not executing (offline queue)

**Recovery steps**:

1. Check Redis container/service:
   ```bash
   docker ps | grep redis
   redis-cli -h $REDIS_HOST ping
   ```
2. If Redis is restarting, the platform's `enableOfflineQueue: true` config will buffer commands. Wait for Redis to become available — commands drain automatically.
3. If Redis OOM (check `INFO memory`):
   ```bash
   redis-cli -h $REDIS_HOST INFO memory | grep used_memory_human
   ```
   - If stream backlog is the cause: `redis-cli XTRIM EXECUTION_REPORT MAXLEN 10000`
   - If position data is excessive: investigate key count with `SCAN`
4. After Redis recovery, verify:
   - `isConnected()` returns true for both clients (check `/diagnostics`)
   - Stream consumer groups resume from last acknowledged ID (no message loss)
   
**Note**: Redis stream consumer groups track the last acknowledged message ID. After a Redis restart that preserves data (RDB/AOF), consumers resume from where they left off with no message loss. After a Redis restart with data loss (no persistence), a full stream-state reconciliation is required — see §4.

---

### 3.3 Database (PostgreSQL) Unavailable

**Symptoms**:
- `GET /health/ready` returns unhealthy (DB check fails)
- Order persistence failures logged as `ERROR`
- Position queries failing

**Recovery steps**:

1. Check database:
   ```bash
   psql $DATABASE_URL -c "SELECT pg_is_in_recovery()"
   ```
2. If primary failed over to replica:
   - Update `DATABASE_URL` environment variable to replica connection string
   - Trigger SIGHUP to reload config: `docker kill --signal HUP trading-platform`
   - **Note**: Sensitive values (DB credentials, connection URL) are NOT hot-reloadable. A full restart is required if the URL changes.
3. If database is being restored from backup:
   - **Stop new trade submissions** by setting `RISK_ENABLED=false` and sending SIGHUP
   - Wait for database restoration to complete
   - Re-enable: `RISK_ENABLED=true` + SIGHUP
4. After database recovery:
   - Run reconciliation: `POST /api/v1/reconciliation/run`
   - Verify open positions match exchange state

---

### 3.4 Platform Process Crash

**Symptoms**:
- Docker container exits unexpectedly
- `GET /health` returns connection refused
- Alerts: process restart detected

**Recovery steps**:

1. Check exit reason:
   ```bash
   docker inspect trading-platform --format='{{.State.ExitCode}} {{.State.Error}}'
   docker logs --tail 50 trading-platform
   ```
2. Common causes:
   - `Exit code 1, ENOMEM` → OOM kill → increase container memory limit or reduce symbol count
   - `Exit code 1, Fatal bootstrap error` → config validation failed → check required env vars
   - `Exit code 137` → SIGKILL (OOM or manual) → investigate memory growth
3. Restart with increased verbosity (non-production only):
   ```bash
   docker run -e LOG_LEVEL=debug trading-platform
   ```
4. After restart:
   - Redis stream consumer groups will resume from last acknowledged position
   - In-flight orders at crash time need reconciliation (§3.6)

---

### 3.5 Server Restart / Graceful Shutdown

**Expected behavior** on SIGTERM/SIGINT:
1. NestJS calls `onModuleDestroy()` on all modules in reverse dependency order
2. `RedisClientService.disconnect()` → `quit()` both clients (drains in-flight commands)
3. `ExecutionEngineService.onModuleDestroy()` → `unsubscribe()` from RiskDecision events
4. `ReloadableConfigService.onModuleDestroy()` → removes SIGHUP handler
5. HTTP server stops accepting new connections; in-flight requests complete

**Recovery after graceful restart**: No state loss — Redis and PostgreSQL preserve all data. Stream consumer groups continue from last acknowledged message.

**Recovery after ungraceful restart (SIGKILL / OOM / crash)**:
1. Any orders submitted to the exchange but not yet acknowledged via stream are "unconfirmed"
2. Run order reconciliation within 5 minutes: `POST /api/v1/reconciliation/run`
3. The reconciliation service queries the exchange for open orders and matches against the local database

---

### 3.6 Order Reconciliation

Run after: database restart, server crash, exchange connectivity gap > 60 seconds.

```bash
# Trigger full reconciliation
curl -X POST -H "Authorization: Bearer $TOKEN" \
     http://<host>/api/v1/reconciliation/run

# Check reconciliation status
curl -H "Authorization: Bearer $TOKEN" \
     http://<host>/api/v1/reconciliation/status
```

Reconciliation:
1. Fetches all open orders from the exchange
2. Compares against local database state
3. Updates local records to match exchange truth
4. Emits `OrderUpdate` events for any discrepancies
5. Logs a summary with count of records updated/closed/orphaned

**Note**: Reconciliation is idempotent and safe to run multiple times.

---

### 3.7 Data Integrity Check

After any recovery scenario involving database restart:

```bash
# Verify position totals match exchange
curl -H "Authorization: Bearer $TOKEN" \
     http://<host>/api/v1/positions/reconcile

# Verify P&L consistency
curl -H "Authorization: Bearer $TOKEN" \
     http://<host>/api/v1/portfolio/verify
```

---

### 3.8 Hot Config Reload (SIGHUP)

Change risk limits, strategy config, or monitoring thresholds without restarting:

```bash
# Edit .env.<environment> on the host (or update the config source)
# Then send SIGHUP
docker kill --signal HUP trading-platform

# Verify reload in logs
docker logs --tail 10 trading-platform | grep "hot-reloaded"
```

Reloadable domains: `risk`, `strategy`, `monitoring`, `alerts`

NOT reloadable (require full restart): `DATABASE_URL`, `REDIS_URL`, `API_KEY_SECRET`, `APP_PORT`, exchange API keys.

---

## 4. State Recovery Matrix

| Event | Redis | DB | In-flight Orders | Action Required |
|-------|-------|----|-----------------|-----------------|
| Graceful restart (SIGTERM) | ✅ preserved | ✅ preserved | ✅ tracked | None — consumers resume from stream |
| Crash (SIGKILL/OOM) | ✅ preserved | ✅ preserved | ⚠️ unconfirmed | Reconcile within 5 min |
| Redis restart (data preserved) | ✅ resumed | ✅ preserved | ✅ tracked | None — consumer groups resume |
| Redis restart (data lost) | ❌ lost | ✅ preserved | ❌ lost | Full reconciliation + audit trail review |
| DB failover | ✅ preserved | ✅ replica | ⚠️ check replica lag | Update DATABASE_URL, restart platform |
| DB restore from backup | ✅ preserved | ⚠️ point-in-time | ❌ may be stale | Disable trading, restore, reconcile |
| Full server loss | ❌ risk | ❌ risk | ❌ | Restore from DR plan; reconcile all |

---

## 5. Rollback Procedure

```bash
# List available Docker image tags
docker images trading-platform --format "table {{.Tag}}\t{{.CreatedAt}}"

# Roll back to previous version
docker stop trading-platform
docker run -d --name trading-platform \
  --env-file .env.production \
  trading-platform:<previous-tag>

# Verify health
curl -sf http://localhost:$APP_PORT/api/v1/health
```

Database migrations are forward-only. Rolling back the application to a version prior to a migration requires a manual database rollback — consult the migration file for the down script.

---

## 6. Post-Incident Template

```markdown
## Incident Report — <date>

**Incident ID**: INC-<number>
**Severity**: P<level>
**Duration**: <start> → <end> (<minutes> min)
**Impact**: <what was affected; financial exposure if any>

### Timeline
- HH:MM — Alert fired / issue noticed
- HH:MM — On-call paged
- HH:MM — Root cause identified
- HH:MM — Mitigation applied
- HH:MM — Service fully restored

### Root Cause
<1-2 sentences>

### Resolution
<steps taken>

### Recurrence Prevention
<code changes / config changes / monitoring additions>

### Open Items
- [ ] <task> — owner — due date
```

---

## 7. Key Contact & Escalation

| Role | Responsibility |
|------|---------------|
| On-call engineer | First response, initial diagnosis |
| Platform lead | Architectural decisions, exchange outage escalation |
| Exchange support | Binance/Bybit/OKX API status, IP allowlisting |
| Cloud provider | Infrastructure-level issues (host failure, network) |

---

## 8. Useful Commands Reference

```bash
# Health
curl http://<host>/api/v1/health
curl http://<host>/api/v1/health/live
curl http://<host>/api/v1/health/ready

# Diagnostics (requires x-api-key header)
curl -H "x-api-key: $KEY" http://<host>/api/v1/diagnostics
curl -H "x-api-key: $KEY" http://<host>/api/v1/diagnostics/runtime

# Heap snapshot (non-production only)
curl -X POST -H "x-api-key: $KEY" http://<host>/api/v1/diagnostics/heap-snapshot

# Redis stream inspection
redis-cli XLEN EXECUTION_REPORT
redis-cli XINFO GROUPS EXECUTION_REPORT
redis-cli XPENDING EXECUTION_REPORT <group-name> - + 10

# Process info
docker stats trading-platform
docker top trading-platform

# Hot reload
docker kill --signal HUP trading-platform
```
