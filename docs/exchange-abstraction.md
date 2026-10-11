# Milestone 4 — Exchange Abstraction Layer

## Why This Abstraction Exists

Every exchange has a different API, different terminology, different error codes, and different rate limit models. Without isolation, a Binance-specific assumption leaks into the strategy engine, the risk engine, and the execution engine — and then switching to Bybit becomes a project, not a configuration change.

The Exchange Abstraction Layer enforces a contract: **the rest of the platform never knows which exchange it is talking to.** Every future exchange must be replaceable without modifying the Strategy Engine, Indicator Engine, Risk Engine, Execution Engine, Position Manager, or Portfolio Manager.

## Architecture Overview

```
Application Layer (Strategy, Risk, Execution, Portfolio)
          │
          │  depends only on interfaces
          ▼
┌─────────────────────────────────────────────────────────┐
│                  Exchange Abstraction                    │
│                                                         │
│  ExchangeFactory ──► AdapterRegistry                    │
│                              │                          │
│                              ▼                          │
│                    ExchangeAdapter (interface)           │
│                    ├── MarketDataProvider               │
│                    ├── TradingProvider                  │
│                    ├── AccountProvider                  │
│                    ├── PositionProvider                 │
│                    ├── OrderProvider                    │
│                    ├── ExchangeMetadataProvider         │
│                    └── ExchangeCapabilityProvider       │
└─────────────────────────────────────────────────────────┘
          │
          │  only concrete adapters cross this line
          ▼
┌─────────────────────────────────────────────────────────┐
│              Exchange Adapter Implementations           │
│   (BinanceSpotAdapter, BybitLinearAdapter, ...)         │
│   Lives in: src/modules/exchange/adapters/<exchange>/   │
└─────────────────────────────────────────────────────────┘
          │
          │  never imported outside the adapter directory
          ▼
     Exchange REST + WebSocket APIs
```

## Interface Segregation

Each provider interface has a single responsibility. Consumers inject only the interface they need — not the full ExchangeAdapter.

| Interface | Consumer |
|-----------|----------|
| `MarketDataProvider` | Strategy Engine, Indicator Engine |
| `TradingProvider` | Execution Engine |
| `AccountProvider` | Risk Engine, Portfolio Manager |
| `PositionProvider` | Position Manager, Risk Engine |
| `OrderProvider` | Execution Engine, Portfolio Manager |
| `ExchangeMetadataProvider` | Order Validator, Symbol Normalizer |
| `ExchangeCapabilityProvider` | All — before calling optional features |

## Symbol Normalization

Every exchange uses a different symbol format. The `SymbolNormalizer` provides bidirectional translation.

```
Exchange format  ──► Normalized format
─────────────────────────────────────
Binance: BTCUSDT       ──► BTC/USDT
Bybit:   BTCUSDT       ──► BTC/USDT
Coinbase: BTC-USD      ──► BTC/USD
Kraken:  XXBTZUSD     ──► BTC/USD

Perpetual:  BTCUSDT    ──► BTC/USDT:USDT
Inverse:    BTCUSD     ──► BTC/USD:BTC
```

The normalizer is seeded at adapter initialization from `ExchangeInfo`. Adapters call `SymbolNormalizer.addMappings()` during `initializeInternal()`.

**Why not auto-decompose?** Auto-splitting "BTCUSDT" → "BTC" + "USDT" requires knowing all valid quote assets, which changes over time. An explicit mapping from exchange metadata handles edge cases like "LINKUSDT" where "LINK" is the base, not "L".

## Sequence Diagrams

### Adapter Initialization (startup)

```
ExchangeModule.onApplicationBootstrap()
  │
  ├──► ExchangeFactory.create({ exchangeId: BINANCE_SPOT, autoInitialize: true })
  │         │
  │         ├──► AdapterRegistry.has(BINANCE_SPOT)        → true
  │         ├──► AdapterRegistry.create(BINANCE_SPOT)     → BinanceSpotAdapter
  │         └──► adapter.initialize()
  │                   │
  │                   ├──► initializeInternal()
  │                   │         ├──► GET /api/v3/exchangeInfo   (Binance REST)
  │                   │         ├──► symbolNormalizer.addMappings([...])
  │                   │         └──► orderStatusNormalizer.registerMappings(...)
  │                   └──► connect()
  │                             └──► connectInternal()
  │                                       └──► WebSocket.connect(wss://stream.binance.com)
  │
  └──► Result<void, ExchangeError>
```

### Order Submission (runtime)

```
ExecutionEngine.submitOrder(request: SubmitOrderRequest)
  │
  ├──► ExchangeFactory.create({ exchangeId })       → ExchangeAdapter
  ├──► adapter.getCapabilities()                    → check supportsBatchOrders etc.
  ├──► adapter.getSymbolInfo(request.symbol)        → SymbolInfo
  ├──► orderValidator.validate(request, symbolInfo) → validated request
  │
  ├──► adapter.submitOrder(request)                 [TradingProvider]
  │         │
  │         ├──► symbolNormalizer.toExchangeSymbol(...)   → "BTCUSDT"
  │         ├──► POST /api/v3/order  { symbol: "BTCUSDT", ... }
  │         ├──► [parse response] mapper.map(rawResponse) → Order
  │         └──► Result<Order, ExchangeError>
  │
  └──► eventBus.publish(MARKET_DATA_EVENTS.EXECUTION_REPORT, executionReport)
```

### Market Data Subscription (streaming)

```
StrategyEngine.start(symbol: NormalizedSymbol)
  │
  ├──► adapter.subscribeToTicker(symbol)            [MarketDataProvider]
  │         │
  │         ├──► symbolNormalizer.toExchangeSymbol(symbol) → "BTCUSDT"
  │         ├──► WebSocket.subscribe("btcusdt@ticker")
  │         └──► Result<MarketDataSubscription, ExchangeError>
  │
  ├──► eventBus.on(MARKET_DATA_EVENTS.TICKER_UPDATED, handler)
  │
  │   [later, on each WebSocket message:]
  │
  ├──► WsFrame → mapper.map(rawTicker) → Ticker
  └──► eventBus.publish(MARKET_DATA_EVENTS.TICKER_UPDATED, ticker)
```

## How to Add a New Exchange

### Step 1 — Add the ExchangeId

```typescript
// src/modules/exchange/enums/exchange.enums.ts
export enum ExchangeId {
  // ... existing
  MY_EXCHANGE_SPOT = 'my_exchange_spot',
}
```

**Rule:** Never remove or rename an existing ExchangeId. Database records reference these strings.

### Step 2 — Create the adapter module directory

```
src/modules/exchange/adapters/my-exchange/
├── my-exchange.adapter.ts          ← extends BaseExchangeAdapter
├── my-exchange.mapper.ts           ← extends AbstractMapper<RawX, NormalizedX>
├── my-exchange.module.ts           ← NestJS module
└── my-exchange.config.ts           ← API keys, endpoints
```

### Step 3 — Implement the adapter

```typescript
export class MyExchangeSpotAdapter extends BaseExchangeAdapter {
  readonly exchangeId = ExchangeId.MY_EXCHANGE_SPOT;
  readonly capabilities: ExchangeCapabilities = { ... };

  protected async initializeInternal(): Promise<void> {
    // 1. Fetch exchange info
    const info = await this.fetchExchangeInfo();
    // 2. Seed symbol normalizer
    this.symbolNormalizer.addMappings(info.symbols.map(...));
    // 3. Register order status mappings
    this.orderStatusNormalizer.registerMappings(ExchangeId.MY_EXCHANGE_SPOT, {
      'open':   OrderStatus.NEW,
      'filled': OrderStatus.FILLED,
      // ...
    });
  }

  protected async connectInternal(): Promise<void> {
    // Establish WebSocket connection
  }

  protected async disconnectInternal(): Promise<void> {
    // Close WebSocket connection
  }

  // Implement all ExchangeAdapter interface methods
  // Never expose raw API response types outside this file
}
```

### Step 4 — Register in the adapter module

```typescript
@Module({ imports: [ExchangeModule] })
export class MyExchangeModule implements OnModuleInit {
  constructor(private readonly registry: AdapterRegistry, ...) {}

  onModuleInit() {
    this.registry.register(
      ExchangeId.MY_EXCHANGE_SPOT,
      () => new MyExchangeSpotAdapter(this.logger, this.symbolNormalizer, ...),
    );
  }
}
```

### Step 5 — Import in AppModule

```typescript
@Module({
  imports: [
    ...,
    ExchangeModule,
    MyExchangeModule,   // ← add here
  ],
})
export class AppModule {}
```

**No changes to ExchangeFactory, ExchangeModule, or any other file.**

## Rules for Adapter Implementations

These rules are enforced by code review. Violating them breaks the abstraction.

| # | Rule | Rationale |
|---|------|-----------|
| 1 | Never import exchange SDKs outside the adapter's own directory | SDK types must not leak into shared code |
| 2 | Never expose raw exchange response types | Callers depend on normalized models only |
| 3 | Never throw — return `Result<T, ExchangeError>` | Exception control flow breaks the Result pattern |
| 4 | Never log raw exchange responses | May contain secrets, PII, or large payloads |
| 5 | Always call `validateSymbol()` before any exchange request | Catches format errors before consuming rate limit weight |
| 6 | Always use `SymbolNormalizer` in both directions | Prevents raw symbols from reaching the application layer |
| 7 | Return `ExchangeUnsupportedOperationError` for features the exchange does not support | Callers must check capabilities before calling |
| 8 | Always check `ExchangeCapabilities` before using optional features | Prevents runtime errors when switching exchanges |
| 9 | Use `clientOrderId` on every order submission | Enables idempotent resubmission after network failures |
| 10 | Map all exchange error codes to specific `ExchangeError` subclasses | Generic errors prevent exchange-specific recovery |

## Normalized Error Hierarchy

```
ExchangeError (abstract)
├── AuthenticationError        — invalid API key or signature
├── RateLimitError             — retry after retryAfterMs (isRetryable: true)
├── InsufficientBalanceError   — provides asset, required, available
├── OrderRejectedError         — exchange rejected the order
├── ExchangeMaintenanceError   — exchange is in downtime
├── UnknownSymbolError         — symbol not found in exchange catalog
├── ExchangeNetworkFailureError — TCP/TLS failure (isRetryable: true)
├── ExchangeConnectionError    — WebSocket closed unexpectedly (isRetryable: true)
├── ExchangeTimeoutError       — no response within timeoutMs (isRetryable: true)
├── ExchangeInvalidRequestError — malformed request (our bug, not theirs)
├── ExchangePermissionDeniedError — API key missing a required permission
├── ExchangeDuplicateOrderError — clientOrderId already used
└── ExchangeUnsupportedOperationError — exchange does not support this feature
```

**`isRetryable`** is `true` only on errors that are transient by nature. The resilience layer uses this flag to decide whether to apply backoff-retry. Never set it true on business-logic errors (insufficient balance, rejected order) — those require human intervention, not retries.

## Rate Limit Model

Each adapter maintains `RateLimitStatus[]` in memory, updated from response headers on every API call. The `ExchangeMetadataProvider.getRateLimitStatus()` method is synchronous — it returns the cached state without making an API request.

The execution engine checks remaining weight before submitting batch orders. The resilience layer wraps adapter calls in `withRetry` + `CircuitBreaker` using `isRetryable` to gate retries.

## Dependency Inversion Verification

The following import is always illegal outside `src/modules/exchange/adapters/`:

```typescript
// NEVER do this in strategy, risk, execution, portfolio, or any shared code:
import { BinanceSpotAdapter } from '...';
import * as Binance from 'binance-api-node';
```

The following is always legal:

```typescript
// Inject by interface in any module:
constructor(private readonly marketData: MarketDataProvider) {}

// Or obtain via factory:
const adapter = await factory.create({ exchangeId: ExchangeId.BINANCE_SPOT });
const marketData: MarketDataProvider = adapter;
```

## Definition of Done Checklist

- [x] All 7 provider interfaces defined (`interfaces/`)
- [x] Composite `ExchangeAdapter` interface
- [x] Normalized models: `MarketTick`, `Ticker`, `OrderBook`, `Trade`, `Order`, `Position`, `Balance`, `ExecutionReport`, `FundingRate`, `LiquidationEvent`, `MarkPrice`
- [x] `ExchangeModelBase` on every normalized model (exchangeId, symbol, timestamp, receivedAt, correlationId)
- [x] `NormalizedSymbol` branded type with `parse()`, `isValid()`, `unsafe()`
- [x] Symbol normalization: `SymbolNormalizer` (bidirectional, exchange-keyed)
- [x] Order status normalization: `OrderStatusNormalizer` (registry pattern, fallback to `UNKNOWN`)
- [x] All canonical enums: `OrderStatus` (including `UNKNOWN`), `OrderSide`, `PositionSide`, `OrderType`, `TimeInForce`, `MarginMode`, `PositionMode`
- [x] `ExchangeError` hierarchy (13 concrete errors, `isRetryable`, `rawMessage`)
- [x] `OrderValidator` — pre-submission rule checking against `SymbolInfo`
- [x] `BaseMapper` / `AbstractMapper` — normalized mapper contract
- [x] `BaseExchangeAdapter` — cross-cutting concerns (logging, error wrapping, connection state)
- [x] `AdapterRegistry` — singleton-per-ExchangeId factory registry
- [x] `ExchangeFactory` — primary entry point with `autoInitialize`
- [x] `ExchangeModule` — wires all providers, non-global
- [x] `EXCHANGE_TOKENS` — Symbol-based DI tokens
- [x] No exchange-specific implementation anywhere in this layer
- [x] Tests for `SymbolNormalizer`, `OrderStatusNormalizer`, `OrderValidator`, `ExchangeFactory`, `BaseExchangeAdapter`, `AbstractMapper`
