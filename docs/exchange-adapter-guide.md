# Exchange Adapter Development Guide

How to add a fully-implemented exchange adapter to the trading platform.

---

## Overview

The platform treats every exchange identically through the `ExchangeAdapter`
interface. A new exchange is nothing more than:

1. A new `ExchangeId` enum value.
2. A class that implements `ExchangeAdapter` (extends `BaseExchangeAdapter`).
3. A NestJS module that registers the adapter with the `AdapterRegistry` and
   `ExchangeRegistry`.

No existing code changes.

---

## Step-by-Step

### 1 — Add the ExchangeId

```typescript
// src/modules/exchange/enums/exchange.enums.ts
export enum ExchangeId {
  // existing entries …
  MY_EXCHANGE_SPOT = 'my_exchange_spot',
}
```

> **Never remove** an existing ExchangeId. Order IDs stored in the database
> carry these values and must remain resolvable.

---

### 2 — Create the directory structure

```
src/modules/exchange/adapters/my-exchange/
  config/
    my-exchange.config.ts      # BybitConfig pattern
    my-exchange.constants.ts   # endpoints, tokens, rate limits
  my-exchange-spot.adapter.ts
  my-exchange.module.ts
```

---

### 3 — Start from StubExchangeAdapter

```typescript
// my-exchange-spot.adapter.ts
import { StubExchangeAdapter } from '@modules/exchange/adapters/stub-exchange.adapter';

export class MyExchangeSpotAdapter extends StubExchangeAdapter {
  readonly exchangeId = ExchangeId.MY_EXCHANGE_SPOT;

  readonly capabilities: ExchangeCapabilities = {
    supportsSpot: true,
    supportsPerpetual: false,
    supportsFutures: false,
    supportsOptions: false,
    supportsMargin: false,
    supportsCrossMargin: false,
    supportsIsolatedMargin: false,
    supportsOco: false,
    supportsTpSl: false,
    supportsBatchOrders: false,
    supportsReduceOnly: false,
    supportsHedgeMode: false,
    supportsTrailingStop: false,
    supportsPostOnly: true,
    supportsConditionalOrders: false,
    supportsWebSocket: true,
    maxBatchOrderSize: 0,
  };
}
```

This compiles immediately. Every method returns `ExchangeUnsupportedOperationError`
until you override it.

---

### 4 — Implement methods incrementally

Override one method group at a time. The recommended order:

1. **`initializeInternal()`** — fetch ExchangeInfo, seed SymbolNormalizer
2. **`ping()` / `getServerTime()`** — connectivity check
3. **`getTicker()` / `getOrderBook()` / `getRecentTrades()`** — market data REST
4. **`subscribeToTicker()` / `subscribeToOrderBook()` / `subscribeToTrades()`** — WebSocket
5. **`getBalance()` / `getAccountInfo()`** — account
6. **`submitOrder()` / `cancelOrder()` / `modifyOrder()`** — trading
7. **`getOpenOrders()` / `getOrderHistory()`** — order queries
8. **Positions / leverage / margin** — futures-specific

Always call `this.symbolNormalizer.toExchangeSymbol(symbol, this.exchangeId)` before
any API call that takes a symbol. Never pass a raw exchange symbol to the caller.

Never throw. Every method must return a `Result<T, ExchangeError>`.

---

### 5 — Symbol normalization

During `initializeInternal()`, seed the shared `SymbolNormalizer`:

```typescript
for (const symbolInfo of exchangeInfo.symbols) {
  this.symbolNormalizer.addMapping({
    exchangeId: this.exchangeId,
    exchangeSymbol: symbolInfo.exchangeSymbol,   // e.g. "BTC-USD"
    normalizedSymbol: symbolInfo.symbol,          // e.g. "BTC/USD"
  });
}
```

After seeding, `toExchangeSymbol('BTC/USD', ExchangeId.MY_EXCHANGE_SPOT)`
returns `'BTC-USD'`.

---

### 6 — Error normalization

Map exchange-specific HTTP status codes and error body codes to the typed
error hierarchy:

| Scenario                     | Error class                       |
|------------------------------|-----------------------------------|
| Invalid API key / signature  | `AuthenticationError`             |
| Rate limit hit               | `RateLimitError`                  |
| Unknown symbol               | `UnknownSymbolError`              |
| Exchange maintenance         | `ExchangeMaintenanceError`        |
| Network timeout              | `ExchangeTimeoutError`            |
| Insufficient balance         | `InsufficientBalanceError`        |
| Order rejected               | `OrderRejectedError`              |
| Duplicate client order id    | `ExchangeDuplicateOrderError`     |
| Unsupported operation        | `ExchangeUnsupportedOperationError` |

Create a `MyExchangeErrorMapper` that converts raw HTTP responses to these classes.
See `BinanceErrorMapper` for the reference implementation.

---

### 7 — Create the module

```typescript
// my-exchange.module.ts
@Module({
  imports: [ExchangeModule],
  providers: [{ provide: MY_EXCHANGE_TOKENS.CONFIG, useFactory: … }],
})
export class MyExchangeModule implements OnModuleInit {
  constructor(
    private readonly adapterRegistry: AdapterRegistry,
    private readonly exchangeRegistry: ExchangeRegistry,
    private readonly symbolNormalizer: SymbolNormalizer,
    private readonly orderStatusNormalizer: OrderStatusNormalizer,
    private readonly orderValidator: OrderValidator,
    private readonly logger: AppLoggerService,
  ) {}

  onModuleInit(): void {
    this.adapterRegistry.register(
      ExchangeId.MY_EXCHANGE_SPOT,
      () => new MyExchangeSpotAdapter(
        this.logger,
        this.symbolNormalizer,
        this.orderStatusNormalizer,
        this.orderValidator,
        // pass any extra dependencies here
      ),
    );
    this.exchangeRegistry.enable(ExchangeId.MY_EXCHANGE_SPOT);
  }
}
```

Import `MyExchangeModule` in `AppModule`. Nothing else changes.

---

### 8 — Write the test suite

Create `tests/unit/my-exchange-spot.adapter.spec.ts`:

```typescript
import { runAdapterContract } from '@modules/exchange/tests/adapter-contract.harness';

describe('MyExchangeSpotAdapter', () => {
  let adapter: MyExchangeSpotAdapter;

  beforeAll(() => {
    adapter = new MyExchangeSpotAdapter(
      mockLogger,
      mockSymbolNormalizer,
      mockOrderStatusNormalizer,
      mockOrderValidator,
    );
  });

  // Validates the full ExchangeAdapter interface contract
  runAdapterContract(() => adapter);
});
```

The harness validates capabilities, identity, structural correctness of every
result, and that no method throws. When the adapter graduates from stub to real,
the same harness verifies live data shapes.

---

## Rules

| Rule | Reason |
|------|--------|
| Never import exchange SDK types outside the adapter directory | Keeps exchange-specific code isolated |
| Never expose raw exchange types to callers | The interface contract uses normalized models only |
| Never throw — always return `Result<T, ExchangeError>` | Callers depend on typed error handling |
| Never log raw API responses | Responses may contain keys, auth tokens, or PII |
| Always call `validateSymbol()` before any request | Prevents invalid symbols from reaching the API |
| Capabilities must be accurate | The router and strategy engine trust them |

---

## Checklist

Before marking an adapter as production-ready:

- [ ] All `StubExchangeAdapter` methods overridden
- [ ] `initializeInternal()` seeds `SymbolNormalizer`
- [ ] All error codes mapped in `ErrorMapper`
- [ ] Rate limit tracking implemented
- [ ] WebSocket subscriptions implemented
- [ ] Health check returns meaningful latency
- [ ] Unit tests pass with `runAdapterContract()`
- [ ] Capability matrix in `exchange-capability-matrix.md` updated
- [ ] Environment variables documented in `env.validation.ts`
