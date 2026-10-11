# Alerting & Notification Engine

## Overview

The alerting subsystem provides intelligent, non-intrusive operational alerting
for the trading platform. It is implemented as a NestJS module (`AlertsModule`)
that integrates with the existing infrastructure without ever blocking the
critical trading path.

**Core guarantee:** `AlertEngineService.raise()` is fire-and-forget. All
database writes and network I/O for notifications happen asynchronously after
the caller has returned.

---

## Alert Levels

| Level    | Severity | Use Case |
|----------|----------|----------|
| INFO     | 1        | Normal operational events (reconnected, recovered) |
| WARNING  | 2        | Degraded performance, approaching thresholds |
| ERROR    | 3        | Component failure, order rejected |
| CRITICAL | 4        | Exchange down, risk limit breached, kill-switch |
| FATAL    | 5        | System unrecoverable — requires immediate operator action |

Escalation flows upward: `INFO → WARNING → ERROR → CRITICAL → FATAL`.

---

## Alert Categories

| Category       | Covers |
|----------------|--------|
| Exchange       | WebSocket disconnects, REST failures, high latency |
| Database       | Connection failures, pool exhaustion, slow queries |
| Redis          | Disconnect, memory saturation, latency |
| Strategy       | Strategy panics, stalled heartbeats |
| Risk           | Daily loss limit, max drawdown, kill-switch activation |
| Execution      | Order rejections, routing failures, timeouts |
| Portfolio      | Sync failures, position mismatches |
| Infrastructure | CPU, memory, disk, queue lag, consumer failures |

---

## Alert Conditions

### Failure Conditions
| Condition | Category | Default Level |
|-----------|----------|---------------|
| `ExchangeDisconnect` | Exchange | CRITICAL |
| `ExchangeHighLatency` | Exchange | WARNING |
| `DatabaseFailure` | Database | CRITICAL |
| `DatabaseHighLatency` | Database | WARNING |
| `DatabasePoolExhausted` | Database | ERROR |
| `RedisDisconnect` | Redis | CRITICAL |
| `RedisHighLatency` | Redis | WARNING |
| `RedisMemoryHigh` | Redis | WARNING |
| `StrategyError` | Strategy | ERROR |
| `StrategyStalled` | Strategy | WARNING |
| `DailyLossLimit` | Risk | CRITICAL |
| `KillSwitchActivated` | Risk | FATAL |
| `MaxDrawdownExceeded` | Risk | CRITICAL |
| `PositionMismatch` | Risk | ERROR |
| `OrderRejected` | Execution | ERROR |
| `HighOrderLatency` | Execution | WARNING |
| `ExecutionFailure` | Execution | ERROR |
| `PortfolioSyncFailed` | Portfolio | ERROR |
| `MemoryLeak` | Infrastructure | CRITICAL |
| `CpuUsage` | Infrastructure | WARNING |
| `DiskUsage` | Infrastructure | WARNING |
| `QueueLag` | Infrastructure | WARNING |
| `ConsumerFailure` | Infrastructure | ERROR |

### Recovery Conditions (auto-resolve their counterpart)
| Recovery Condition | Resolves |
|-------------------|----------|
| `ExchangeReconnected` | `ExchangeDisconnect` |
| `DatabaseRecovered` | `DatabaseFailure` |
| `RedisReconnected` | `RedisDisconnect` |
| `StrategyRecovered` | `StrategyError` |
| `RiskResolved` | `DailyLossLimit` |
| `ExecutionResolved` | `ExecutionFailure` |
| `PortfolioRecovered` | `PortfolioSyncFailed` |
| `ConsumerRecovered` | `ConsumerFailure` |
| `InfraRecovered` | `MemoryLeak` |

---

## Alert Lifecycle

```
              raise(input)
                  │
        ┌─────────▼─────────┐
        │  Recovery check    │
        └─────────┬─────────┘
               yes│                          no
        ┌─────────▼─────────┐      ┌─────────▼──────────┐
        │ Auto-resolve open  │      │  Check cooldown     │
        │ alert + save recov │      │  (Redis / in-memory)│
        └─────────┬─────────┘      └──────────┬──────────┘
                  │                   in       │       out
                  │            ┌──────▼──┐  ┌──▼──────────┐
                  │            │Suppress │  │ Save + notif │
                  │            │+escalate│  │ (async)      │
                  │            └──────┬──┘  └──────────────┘
                  │              esc? │
                  │          yes ▼    │ no
                  │       ┌───────┐   │
                  │       │Escalate   │
                  │       │+notify│   │
                  │       └───────┘   │
                  └────────────────── ┘
                         return result
```

### States

```
open → acknowledged → resolved
 └────────────────────────────┘ (skip acknowledged)
```

---

## Rate Limiting

The engine prevents alert storms through per-fingerprint cooldowns.

**Fingerprint** = `sha256(category:condition:source)` (first 64 hex chars).

**Cooldown** (default: 300s):  
Within the cooldown window, repeated raises of the same condition/source are
_suppressed_ — a counter is incremented but no new alert is saved or dispatched.

**Suppression counter** (rolling window, default: 900s):  
Counts how many suppressed raises occurred within the escalation window.
When `suppressedCount % escalationThreshold === 0` the alert is escalated.

**Redis keys** (with TTL):

| Key | Content | TTL |
|-----|---------|-----|
| `alert:cooldown:<fingerprint>` | `"1"` | `ALERTS_COOLDOWN_SECONDS` |
| `alert:suppress:<fingerprint>` | integer | `ALERTS_ESCALATION_WINDOW_SECONDS` |

Both keys fall back to an in-memory `Map` if Redis is unavailable, so rate
limiting is always active even during Redis outages.

---

## Escalation Policy

| After N suppressed repeats | Escalation |
|----------------------------|------------|
| `escalationThreshold` (3)  | level + 1 |
| `2 × threshold` (6)        | level + 2 (if not re-dispatched) |
| `3 × threshold` (9)        | level + 3 |
| ...up to FATAL             | capped at FATAL |

After each escalation the cooldown resets, the suppression counter clears, and
a fresh notification fires at the higher level.

---

## Notification Channels

### Routing by Level (defaults)

| Level    | Channels |
|----------|---------|
| INFO     | (none) |
| WARNING  | (none) |
| ERROR    | discord, slack |
| CRITICAL | discord, slack, telegram, webhook |
| FATAL    | discord, slack, telegram, email, webhook |

Override via `ALERT_ROUTE_<LEVEL>` env vars (comma-separated channel names).

### Channel Configuration

#### Discord
```env
ALERT_DISCORD_ENABLED=true
ALERT_DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
ALERT_DISCORD_USERNAME=TradingBot Alerts
ALERT_DISCORD_TIMEOUT_MS=5000
```

#### Telegram
```env
ALERT_TELEGRAM_ENABLED=true
ALERT_TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
ALERT_TELEGRAM_CHAT_ID=-1001234567890
ALERT_TELEGRAM_TIMEOUT_MS=5000
```

#### Slack
```env
ALERT_SLACK_ENABLED=true
ALERT_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
ALERT_SLACK_CHANNEL=#alerts
ALERT_SLACK_USERNAME=TradingBot Alerts
ALERT_SLACK_TIMEOUT_MS=5000
```

#### Webhook (generic)
```env
ALERT_WEBHOOK_ENABLED=true
ALERT_WEBHOOK_URL=https://your-ops-system/alerts
ALERT_WEBHOOK_METHOD=POST
ALERT_WEBHOOK_HEADERS={"Authorization":"Bearer token"}
ALERT_WEBHOOK_SECRET=my-hmac-secret   # empty = unsigned
ALERT_WEBHOOK_TIMEOUT_MS=5000
```

When `ALERT_WEBHOOK_SECRET` is set, the request carries:
```
X-Alert-Signature: sha256=<hmac-sha256-of-body>
```

#### Email (SMTP)
```env
ALERT_EMAIL_ENABLED=true
ALERT_EMAIL_HOST=smtp.gmail.com
ALERT_EMAIL_PORT=465
ALERT_EMAIL_SECURE=true
ALERT_EMAIL_USER=alerts@example.com
ALERT_EMAIL_PASSWORD=app-password
ALERT_EMAIL_FROM=alerts@example.com
ALERT_EMAIL_TO=ops@example.com,backup@example.com
ALERT_EMAIL_TIMEOUT_MS=10000
```

> **Note:** For production, prefer an SMTP relay (SendGrid, SES) over direct
> SMTP to ensure deliverability. Replace the SMTP client in `EmailChannel`
> with the relay's API SDK.

---

## Usage — Raising Alerts

Inject `AlertEngineService` and call `raise()`:

```typescript
import { AlertEngineService } from '@modules/alerts/application/services/alert-engine.service';
import { AlertLevel } from '@modules/alerts/domain/alert-level.enum';
import { AlertCategory } from '@modules/alerts/domain/alert-category.enum';
import { AlertCondition } from '@modules/alerts/domain/alert-condition.enum';

@Injectable()
export class BinanceWsAdapter {
  constructor(private readonly alertEngine: AlertEngineService) {}

  private onDisconnect(): void {
    // Fire-and-forget — never await in hot path
    void this.alertEngine.raise({
      level: AlertLevel.CRITICAL,
      category: AlertCategory.EXCHANGE,
      condition: AlertCondition.EXCHANGE_DISCONNECT,
      title: 'Binance WebSocket disconnected',
      message: `Stream dropped after 3 missed heartbeats`,
      source: BinanceWsAdapter.name,
      context: { exchangeId: 'BINANCE_SPOT', attempt: 3 },
    });
  }

  private onReconnect(): void {
    void this.alertEngine.raise({
      level: AlertLevel.INFO,
      category: AlertCategory.EXCHANGE,
      condition: AlertCondition.EXCHANGE_RECONNECTED,
      title: 'Binance WebSocket reconnected',
      message: 'Stream restored after reconnect',
      source: BinanceWsAdapter.name,
    });
  }
}
```

### Acknowledging / Resolving

```typescript
// Acknowledge (operator took note)
await alertEngine.acknowledge(alertId, 'ops-engineer');

// Resolve (condition fixed)
await alertEngine.resolve(alertId, 'Restarted exchange adapter', 'ops-engineer');
```

---

## Persistence

All alerts are stored in the `alerts` PostgreSQL table (migration `003_alerts`).

| Column | Description |
|--------|-------------|
| `id` | UUID primary key |
| `level` | INFO \| WARNING \| ERROR \| CRITICAL \| FATAL |
| `category` | AlertCategory |
| `condition` | AlertCondition |
| `fingerprint` | sha256(category:condition:source) — dedup key |
| `status` | open \| acknowledged \| resolved |
| `suppressed_count` | Duplicate raises within cooldown window |
| `escalation_count` | Number of level promotions |
| `notification_channels` | JSONB: channels that delivered successfully |
| `notification_sent_at` | When notifications were dispatched |
| `acknowledged_by` | Operator identifier |
| `acknowledged_at` | When acknowledged |
| `resolved_at` | When resolved |
| `resolution_note` | Free-text resolution description |
| `is_recovery` | True for recovery notifications |

**Indexes:**
- `idx_alerts_fingerprint_status` — O(1) dedup lookup
- `idx_alerts_open` (partial, `WHERE status='open'`) — fast open-alert scans
- `idx_alerts_level_status` — dashboard queries
- `idx_alerts_category` — category filtering
- `idx_alerts_created_at` — time-range queries

---

## Thresholds

All thresholds are configurable via environment variables (hot-reloadable on SIGHUP):

| Variable | Default | Meaning |
|----------|---------|---------|
| `ALERTS_COOLDOWN_SECONDS` | 300 | Suppress repeats for 5 min |
| `ALERTS_ESCALATION_THRESHOLD` | 3 | Escalate after 3 suppressions |
| `ALERTS_ESCALATION_WINDOW_SECONDS` | 900 | Suppression count window (15 min) |
| `ALERTS_CPU_WARN_PERCENT` | 85 | CPU usage WARNING threshold |
| `ALERTS_MEMORY_WARN_PERCENT` | 85 | Memory usage WARNING threshold |
| `ALERTS_DISK_WARN_PERCENT` | 85 | Disk usage WARNING threshold |
| `ALERTS_QUEUE_LAG_WARN_MESSAGES` | 1000 | Queue consumer lag WARNING |
| `ALERTS_LATENCY_WARN_MS` | 500 | General latency WARNING |
| `ALERTS_DRAWDOWN_WARN_PERCENT` | 5 | Drawdown WARNING |
| `ALERTS_POSITION_WARN_PERCENT` | 80 | Position utilization WARNING |

---

## Adding a New Channel

1. Create `src/modules/alerts/infrastructure/channels/<name>.channel.ts`
2. Implement `AlertChannel` interface:
   - `name`: stable lowercase identifier
   - `isConfigured()`: validates required env vars
   - `send(alert: Alert): Promise<boolean>`: delivers notification, never throws
3. Register in `AlertsModule` providers and inject array
4. Add env vars to `alerts.config.ts` and `env.validation.ts`
5. Add channel name to default routing in env defaults

---

## Testing

Unit tests covering:
- `AlertRateLimiterService` — fingerprinting, cooldown, suppression, Redis fallback
- `AlertEscalationService` — escalation thresholds, level promotion, immutability
- `AlertEngineService` — fresh raises, suppression, escalation, recovery,
  disabled engine, error resilience, flood conditions, notification failures

Run with:
```bash
pnpm test tests/unit/alerts/
```

### Test Scenarios Covered

| Scenario | Test File |
|----------|-----------|
| Repeated failures (rate-limited) | `alert-engine.service.spec.ts` |
| Recovery & auto-resolution | `alert-engine.service.spec.ts` |
| Flood conditions (100 concurrent) | `alert-engine.service.spec.ts` |
| Escalation at threshold multiples | `alert-escalation.service.spec.ts` |
| FATAL ceiling (no further escalation) | `alert-escalation.service.spec.ts` |
| Redis unavailable fallback | `alert-rate-limiter.service.spec.ts` |
| Notification channel failure | `alert-engine.service.spec.ts` |

---

## Definition of Done — Checklist

- [x] Critical failures immediately notify operators (CRITICAL/FATAL routing)
- [x] Alert storms prevented (per-fingerprint cooldown + suppression)
- [x] Escalation: repeated suppressed alerts promote to higher severity
- [x] Recovery alerts auto-resolve matching open alerts
- [x] All alerts persisted with full lifecycle tracking
- [x] Acknowledgement and manual resolution supported
- [x] Five notification channels: Discord, Telegram, Slack, Email, Webhook
- [x] Webhook payloads signed with HMAC-SHA256
- [x] Rate limiter falls back to in-memory when Redis unavailable
- [x] AlertEngine never throws — trading path is never interrupted
- [x] All channels have configurable timeouts
- [x] Unit tests for engine, rate-limiter, escalation
- [x] Full environment variable schema with validation
- [x] Database migration with appropriate indexes
