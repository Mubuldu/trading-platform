# Position Manager

Source of truth for all current trading positions. Never generates orders or signals — it only reacts to fills.

---

## Architecture

```
EXECUTION_REPORT stream
        │
        ▼
PositionManagerService (consumer group: position-manager)
        │
        ├── PositionValidatorService   — reject duplicate/invalid fills
        ├── PositionStateMachineService — apply fill → new state
        ├── PnlCalculatorService       — compute realized/unrealized PnL
        ├── PositionCacheService        — Redis hash read/write
        │
        └── Outputs (Redis streams)
              ├── position:update
              ├── portfolio:update
              └── risk:update
```

---

## Position Lifecycle

```
      first fill
FLAT ──────────────► OPEN
                      │
          same-dir    │    opposite-dir (partial)
          fill  ──►SCALING   ──► REDUCING ──► OPEN
                              │
                    opposite-dir (full)
                              ▼
                            FLAT
                              ▲
                    opposite-dir (excess) creates REVERSE:
                    close entire position → open in opposite direction
```

State transitions are enforced exclusively by `PositionStateMachineService`. No other code mutates position state.

---

## PnL Mathematics

### Average Entry Price (scale-in)

```
newAvg = (existingQty × existingAvg + fillQty × fillPrice) / (existingQty + fillQty)
```

### Realized PnL

```
LONG:  realizedPnL = (closePrice − avgEntry) × closedQty
SHORT: realizedPnL = (avgEntry − closePrice) × closedQty
```

Realized PnL accumulates across all partial closes. It never resets until the position is re-opened after going flat.

### Unrealized PnL

```
LONG:  unrealizedPnL = (markPrice − avgEntry) × openQty
SHORT: unrealizedPnL = (avgEntry − markPrice) × openQty
```

`markPrice` is the last fill price at the time of processing (no separate ticker feed required).

### Gross / Net / Fee-Adjusted PnL

```
grossPnL       = realizedPnL + unrealizedPnL
netPnL         = grossPnL          (fees not yet deducted in this milestone)
feeAdjustedPnL = netPnL − totalFees
```

---

## State Machine

| Current State | Fill Side      | Effect                                    | Resulting State |
|---------------|----------------|-------------------------------------------|-----------------|
| FLAT          | BUY            | Open LONG                                 | OPEN            |
| FLAT          | SELL           | Open SHORT                                | OPEN            |
| OPEN (LONG)   | BUY            | Increase qty, recalc avg entry            | OPEN            |
| OPEN (LONG)   | SELL (partial) | Reduce qty, realize partial PnL           | OPEN            |
| OPEN (LONG)   | SELL (full)    | Close, realize full PnL                   | FLAT            |
| OPEN (LONG)   | SELL (excess)  | Close LONG + open SHORT with excess qty   | OPEN            |
| OPEN (SHORT)  | SELL           | Symmetric to LONG rules                   | OPEN            |
| OPEN (SHORT)  | BUY (partial)  | Reduce qty, realize partial PnL           | OPEN            |
| OPEN (SHORT)  | BUY (full)     | Close, realize full PnL                   | FLAT            |
| OPEN (SHORT)  | BUY (excess)   | Close SHORT + open LONG with excess qty   | OPEN            |

---

## Recovery

On startup (`onModuleInit`), the consumer starts with `startId: '0'` — this replays unacknowledged messages from the Redis stream. Pending messages left by a previous crash are picked up automatically.

For positions that existed before a process restart:
1. Cache miss triggers DB lookup via `PositionRepository.findByAccountAndSymbol`.
2. The most recent open position row is deserialized into a `PositionModel`.
3. The recovered model is written back to Redis cache.
4. Processing continues with fill history intact (duplicate detection via `fillIds`).

The `fillIds` array is populated from Redis cache, not the DB row, which means duplicate protection only works within the same session after recovery. This is acceptable because Redis consumer groups guarantee at-least-once delivery and the duplicate check covers the re-delivery window.

---

## Persistence

| Layer      | Mechanism                         | When                                    |
|------------|-----------------------------------|-----------------------------------------|
| Redis      | `PositionCacheService` (hash)     | Every fill — synchronous, hot path      |
| PostgreSQL | `PositionRepository`              | Every fill — async, best-effort         |
| Streams    | `POSITION_UPDATE`, `PORTFOLIO_UPDATE`, `RISK_UPDATE` | Every fill |

PostgreSQL errors are logged but do not block stream processing. The Redis cache is the primary live source; PostgreSQL is the durable recovery store.

---

## Validation Rules

| Rule                  | What is rejected                                        |
|-----------------------|---------------------------------------------------------|
| Negative quantity     | `executedQuantity < 0`                                  |
| Zero/negative price   | `averagePrice ≤ 0`                                      |
| Duplicate fill        | `fillId` already present in `position.fillIds`          |
| Non-actionable report | `executedQuantity === 0` or report type is ACCEPTED/REJECTED/CANCELLED |
| Failed status         | `status` is FAILED, CANCELLED, REJECTED, PENDING, SUBMITTED |

---

## Configuration

| Env Variable                  | Default             | Description                                 |
|-------------------------------|---------------------|---------------------------------------------|
| `POSITION_MANAGER_ENABLED`    | `true`              | Disable to suspend position tracking        |
| `POSITION_DEFAULT_ACCOUNT_ID` | `default`           | Account ID written to the positions table   |
| `POSITION_CONSUMER_GROUP`     | `position-manager`  | Redis consumer group name                   |
| `POSITION_CACHE_KEY_PREFIX`   | `positions`         | Redis hash key prefix                       |

---

## Metrics (via portfolio:update stream)

- `totalOpenPositions` — live open position count
- `winningPositions` — positions with `unrealizedPnl > 0`
- `losingPositions` — positions with `unrealizedPnl < 0`
- `totalExposure` — sum of `qty × avgEntry` across all open positions
- `totalUnrealizedPnl`
- `totalRealizedPnl`
- `feeAdjustedPnl`
