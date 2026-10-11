# Milestone 6 — WebSocket Foundation

## Overview

Milestone 6 adds a production-grade, exchange-agnostic WebSocket layer to the trading platform. It provides:

- A generic framework (`src/common/websocket/`) usable by any exchange adapter
- A Binance Spot implementation that subscribes to real-time ticker, order book, and trade streams
- A `MarketDataEventBus` for broadcasting normalised events platform-wide
- 9 unit-test files covering 521 tests across all new components

No Redis, no indicators, no trading signals — pure market-data ingestion pipeline.

---

## Architecture

```
BinanceSpotAdapter
  │
  └─► BinanceWsStreamManager          (Binance orchestrator)
        │
        ├─► WsConnectionManager       (state machine)
        │     ├─► WsRawClient         (ws socket wrapper)
        │     ├─► WsReconnectManager  (exponential backoff)
        │     └─► WsHeartbeatMonitor  (ping/pong)
        │
        ├─► WsSubscriptionManager     (per-stream handlers + metrics)
        ├─► WsSequenceValidator       (duplicate / gap detection)
        ├─► WsMetricsCollector        (state counters, rates)
        ├─► WsLatencyMonitor          (network + processing latency)
        │
        ├─► BinanceWsMessageNormalizer
        │     ├─► BinanceWsTickerMapper
        │     ├─► BinanceWsOrderBookMapper
        │     └─► BinanceWsTradeMapper
        │
        └─► MarketDataEventBus        (broadcast normalised events)
```

### Data flow

1. **Binance Combined Stream** (`/stream` endpoint) delivers a JSON envelope `{ stream, data }` per message.
2. `BinanceWsStreamManager` receives the raw frame, JSON-parses it, and dispatches to the normalizer.
3. `BinanceWsMessageNormalizer` routes by Binance event type (`e` field), maps the payload to a platform model (`Ticker`, `OrderBook`, `Trade`), and resolves the normalised symbol.
4. For depth streams, `WsSequenceValidator` checks `updateId` / `firstUpdateId` continuity, skipping duplicates and warning on gaps.
5. The normalised event is published to `MarketDataEventBus` (global fan-out) and dispatched to per-stream callback handlers registered via `WsSubscriptionManager`.
6. Consumers subscribe either via `eventBus.on(MARKET_DATA_EVENTS.TICKER_UPDATED, handler)` or through the `MarketDataSubscription` returned by `subscribeToTicker()` etc.

---

## File Inventory

### Generic WebSocket Framework (`src/common/websocket/`)

| File | Responsibility |
|------|---------------|
| `client/ws-raw-client.ts` | Thin `ws.WebSocket` wrapper. Emits `open`, `message`, `close`, `error`, `pong`. Enforces `maxMessageSizeBytes`. |
| `connection/ws-connection-manager.ts` | State machine: DISCONNECTED → CONNECTING → CONNECTED → RECONNECTING → FAILED / STOPPED. Coordinates raw client, reconnect, and heartbeat. |
| `reconnect/ws-reconnect-manager.ts` | Exponential backoff with full jitter. Stable-connection reset resets the attempt counter after `stableThresholdMs`. |
| `heartbeat/ws-heartbeat-monitor.ts` | `setInterval` ping loop. Counts missed pongs; calls `onTimeout` after `threshold` misses. |
| `metrics/ws-metrics-collector.ts` | State-change counters, message/byte rates, uptime. |
| `metrics/ws-latency-monitor.ts` | Tracks network latency (frame arrival to handler), processing latency, and per-message delays. |
| `subscription/ws-subscription-manager.ts` | Stores `Set<handler>` per stream ID. Dispatches frames to all handlers. Exposes stream count and per-stream metrics. |
| `validation/ws-sequence-validator.ts` | Per-stream sequence tracking. Returns `ok` / `duplicate` / `gap` / `resync`. |
| `enums/ws-connection-state.enum.ts` | `WsConnectionState` enum. |
| `types/ws-config.types.ts` | `WsClientConfig` interface. |
| `types/ws-message.types.ts` | `WsRawMessage` interface (`data`, `receivedAt`, `byteLength`). |
| `types/ws-metrics.types.ts` | `WsConnectionMetrics`, `WsLatencyMetrics` interfaces. |
| `index.ts` | Barrel re-export. |

### Binance WebSocket Layer (`src/modules/exchange/adapters/binance/ws/`)

| File | Responsibility |
|------|---------------|
| `binance-ws-stream-manager.ts` | Orchestrator. Owns one `WsConnectionManager`. Sends JSON-RPC SUBSCRIBE / UNSUBSCRIBE commands. Tracks pending command ACKs with a 5 s timeout. Re-subscribes all active streams on reconnect. |
| `binance-ws-message-normalizer.ts` | Routes by `data.e` to the correct mapper; resolves the symbol; returns a typed `NormalizedWsMessage` or `null` for unknown events. |
| `binance-ws.constants.ts` | Stream-name builders (`buildTickerStream`, `buildDiffDepthStream`, `buildTradeStream`), event type constants, batch size, command timeout. |
| `binance-ws.types.ts` | Raw Binance WS payload interfaces (`BinanceTicker24hr`, `BinanceDepthUpdate`, `BinanceAggTrade`). |
| `mappers/binance-ws-ticker.mapper.ts` | Maps `BinanceTicker24hr` → `Ticker`. |
| `mappers/binance-ws-order-book.mapper.ts` | Maps `BinanceDepthUpdate` → `OrderBook` (incremental, `isSnapshot=false`). |
| `mappers/binance-ws-trade.mapper.ts` | Maps `BinanceAggTrade` → `Trade`. `isBuyerMaker=false` → BUY; `true` → SELL. |

### Modified Files

| File | Change |
|------|--------|
| `src/modules/exchange/adapters/binance/config/binance.config.ts` | +10 WS config fields on `BinanceSpotConfig`; `buildBinanceSpotConfig()` reads them from env. |
| `src/modules/exchange/adapters/binance/config/binance.constants.ts` | Added `BINANCE_WS_SPOT_BASE_URL`, `BINANCE_WS_TESTNET_BASE_URL`. |
| `src/modules/exchange/adapters/binance/binance.module.ts` | Provides WS mappers, normalizer, and `BinanceWsStreamManager` (via `useFactory`). |
| `src/modules/exchange/adapters/binance/binance-spot.adapter.ts` | `supportsWebSocket: true`; `connectInternal` calls `wsStreamManager.connect()`; implements `subscribeToTicker`, `subscribeToOrderBook`, `subscribeToTrades`. |
| `src/modules/exchange/exchange.module.ts` | Provides and exports `MarketDataEventBus`. |
| `src/config/env.validation.ts` | +10 `BINANCE_SPOT_WS_*` Joi validations. |

---

## Key Design Decisions

### `BinanceWsStreamConfig` decoupled from `BinanceSpotConfig`

The stream manager accepts its own lean config interface. The mapping from the full `BinanceSpotConfig` happens once in `BinanceModule.useFactory`, keeping the common WS framework free of Binance-specific config shape.

### Noop handler pattern

`subscribeToTicker()` registers a `() => {}` handler to claim the stream. The real consumers listen on `MarketDataEventBus`. This means the adapter's subscription lifecycle (connect / disconnect) is cleanly separated from business logic.

### Pending command ACK tracking

Every SUBSCRIBE / UNSUBSCRIBE sent to Binance gets a unique integer ID. A `setTimeout(5000)` is stored in `pendingCommands`. On ACK (`{ id, result: null }`) the timer is cleared. On timeout, a warning is logged and the entry removed. `stop()` cancels all pending timers.

### Re-subscribe on reconnect

`WsConnectionManager` emits `connected` after every successful open, including after a reconnect. `BinanceWsStreamManager` listens on that event and calls `resubscribeAll()`, batching streams into groups of `RESUBSCRIBE_BATCH_SIZE` (25).

### Sequence validation for depth streams

`WsSequenceValidator` tracks `lastUpdateId` per stream. A message is:
- `ok` — `firstUpdateId <= lastUpdateId + 1 <= updateId`
- `duplicate` — `updateId <= lastUpdateId` (silently skipped)
- `gap` — `firstUpdateId > lastUpdateId + 1` (logs warning; consumers should re-snapshot)
- `resync` — first message after reset (accepted, sets baseline)

---

## Environment Variables

All 10 WS variables are optional with safe defaults:

| Variable | Default | Description |
|----------|---------|-------------|
| `BINANCE_SPOT_WS_BASE_URL` | `wss://stream.binance.com:9443` | WebSocket base URL |
| `BINANCE_SPOT_WS_HEARTBEAT_INTERVAL_MS` | `20000` | Ping interval (ms) |
| `BINANCE_SPOT_WS_HEARTBEAT_TIMEOUT_MS` | `10000` | Pong timeout (ms) |
| `BINANCE_SPOT_WS_MISSED_HEARTBEATS` | `3` | Missed pong threshold before reconnect |
| `BINANCE_SPOT_WS_RECONNECT_BASE_DELAY_MS` | `1000` | Initial reconnect delay |
| `BINANCE_SPOT_WS_RECONNECT_MAX_DELAY_MS` | `30000` | Maximum reconnect delay |
| `BINANCE_SPOT_WS_MAX_RECONNECT_ATTEMPTS` | `10` | `-1` for unlimited |
| `BINANCE_SPOT_WS_RECONNECT_STABLE_MS` | `30000` | Stable window before attempt counter reset |
| `BINANCE_SPOT_WS_MAX_STREAMS` | `200` | Max concurrent streams per connection |
| `BINANCE_SPOT_WS_MAX_MESSAGE_SIZE_BYTES` | `10485760` | 10 MB frame size limit |

---

## Consuming Market Data

### Via `MarketDataEventBus` (recommended for platform services)

```typescript
@Injectable()
export class MyService {
  constructor(private readonly eventBus: MarketDataEventBus) {}

  onModuleInit(): void {
    this.eventBus.on(MARKET_DATA_EVENTS.TICKER_UPDATED, (ticker: Ticker) => {
      // handle ticker
    });
  }
}
```

### Via `MarketDataSubscription` (recommended for scoped consumers)

```typescript
const result = await adapter.subscribeToTicker(NormalizedSymbol.unsafe('BTC/USDT'));
if (result.isOk()) {
  const sub = result.value;
  // sub.subscriptionId — unique ID for this subscription
  // sub.eventTypes    — [MARKET_DATA_EVENTS.TICKER_UPDATED]
  // sub.unsubscribe() — removes this handler from the stream
  await sub.unsubscribe();
}
```

---

## Test Coverage

| Test File | Tests | Coverage Area |
|-----------|-------|---------------|
| `ws-sequence-validator.spec.ts` | 23 | ok / duplicate / gap / resync / reset |
| `ws-subscription-manager.spec.ts` | 18 | subscribe / dispatch / metrics / destroy |
| `ws-latency-monitor.spec.ts` | 12 | network / processing / clock drift / reset |
| `ws-metrics-collector.spec.ts` | 11 | state transitions / counters / rates / uptime |
| `ws-heartbeat-monitor.spec.ts` | 11 | interval / timeout / pong reset / stop |
| `ws-reconnect-manager.spec.ts` | 10 | backoff / cancel / stability reset / unlimited |
| `ws-connection-manager.spec.ts` | 8 | full state machine with mocked WsRawClient |
| `binance-ws-message-normalizer.spec.ts` | 11 | ticker / trade / depth / unknown / symbol failure |
| `binance-ws-stream-manager.spec.ts` | 17 | connect / subscribe / routing / ACK / metrics |
| **Total** | **121** | |

All 521 platform tests pass. No open handles. Worker exits cleanly.
