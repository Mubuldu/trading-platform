# Milestone 5 — Binance Spot REST Adapter

## Overview

The Binance adapter implements the `ExchangeAdapter` interface for Binance Spot (REST only).
WebSocket streaming is deferred to a future milestone. Every call passes through the abstraction
layer — no business module has any knowledge of Binance.

---

## Authentication Flow

```
1. Client generates API Key + Secret on binance.com → Account → API Management
2. All signed requests carry header:  X-MBX-APIKEY: <apiKey>
3. Signed parameters:
      timestamp = serverAdjustedTime()          ← BinanceServerTimeService
      recvWindow = 5000 (ms)
      signature  = HMAC-SHA256(queryString, secretKey)   ← BinanceSignatureService
4. Query string:  symbol=BTCUSDT&side=BUY&...&timestamp=1700000000000&recvWindow=5000&signature=<hex>
5. The signature covers EVERY parameter including timestamp.
   Any modification after signing invalidates the request.
```

**Security rules enforced in code:**
- The secret key is never logged, stored in a class field, or included in error messages.
- The `rawMessage` field on ExchangeError carries the original Binance error message for internal diagnostics only — it is never forwarded to API consumers.

---

## Request Lifecycle

```
BinanceSpotAdapter.submitOrder(request)
  │
  ├─ validateSymbol()              ← format check (BASE/QUOTE)
  ├─ symbolNormalizer.toExchangeSymbol()   ← BTC/USDT → BTCUSDT
  ├─ getSymbolInfo()               ← from ExchangeInfo cache
  ├─ orderValidator.validate()     ← price precision, quantity, notional
  │
  └─ restClient.execute({ signed: true, weight: 1 })
          │
          ├─ rateLimitManager.checkRequestWeight(1)   ← pre-flight check
          ├─ rateLimitManager.checkOrderRate()        ← order-rate check
          │
          └─ [retry loop: maxRetries=3, exponential backoff]
                  │
                  └─ circuitBreaker.execute()
                          │
                          └─ rawRequest()
                                  ├─ signatureService.buildSignedQueryString()
                                  ├─ https.request (keep-alive agent)
                                  ├─ parseRateLimitHeaders()
                                  ├─ rateLimitManager.updateFromHeaders()
                                  │
                                  ├─ 200 → JSON.parse → return T
                                  └─ !200 → errorMapper.fromHttpResponse() → throw ExchangeError
```

---

## Retry Policy

| Condition | Retried? |
|-----------|----------|
| Network failure (TCP error, DNS) | Yes — up to `maxRetries` with exponential backoff |
| Timeout (configurable, default 10s) | Yes — `ExchangeTimeoutError.isRetryable = true` |
| Server error (HTTP 5xx) | Yes — `ExchangeNetworkFailureError.isRetryable = true` |
| Rate limit (HTTP 429 / code -1003) | Yes — `RateLimitError.isRetryable = true` |
| Authentication error (code -1022) | No — fix credentials and restart |
| Invalid request (HTTP 400) | No — caller bug, fix the request |
| POST/DELETE/PUT | Never retried (not idempotent) |

Exponential backoff: `delay = random(0, baseMs * 2^(attempt-1))`, capped at 10 seconds.

---

## Rate Limiting

Binance enforces three independent rate limit windows:

| Window | Limit | Header |
|--------|-------|--------|
| Request weight / minute | 6,000 | `X-MBX-USED-WEIGHT-1M` |
| Order count / 10 seconds | 100 | `X-MBX-ORDER-COUNT-10S` |
| Order count / day | 200,000 | `X-MBX-ORDER-COUNT-1D` |

`BinanceRateLimitManager` parses these headers from every response. Before each request, it
checks whether the projected usage would exceed 95% of the limit. If it would, the request
is rejected immediately with `RateLimitError` (retryable) so the caller applies backoff.

At 80% usage, a warning log is emitted but requests continue.

---

## Circuit Breaker

The circuit breaker (`CircuitBreaker` from M2) wraps every HTTP call. It opens after 5
consecutive infrastructure failures (network error, timeout, maintenance). Once open, all
requests fail immediately for 60 seconds, then one probe request is allowed to test recovery.

| Error type | Trips circuit? |
|------------|---------------|
| `ExchangeNetworkFailureError` | Yes |
| `ExchangeTimeoutError` | Yes |
| `ExchangeMaintenanceError` | Yes |
| `RateLimitError` | No — rate limits are expected, not infrastructure failures |
| `AuthenticationError` | No — operator error, not exchange failure |
| `OrderRejectedError` | No — business logic failure |

---

## Server Time Synchronization

Binance rejects requests where the `timestamp` parameter deviates from server time
by more than `recvWindow` (default 5000ms). Clock drift causes `-1021 INVALID_TIMESTAMP`.

At initialization:
1. `GET /api/v3/time` fetches the Binance server time (unsigned, no timestamp needed)
2. `BinanceServerTimeService.updateOffset(serverTime, roundTripMs)` stores the offset
3. All subsequent signed requests use `Date.now() + offsetMs` as the timestamp

The adapter re-syncs when it detects drift > 1000ms (observable via response timing).

---

## Symbol Normalization

On initialization, all tradeable spot symbols from `GET /api/v3/exchangeInfo` are registered
with `SymbolNormalizer`. Thereafter, conversions are O(1) map lookups:

```
Binance: "BTCUSDT" ←→ Normalized: "BTC/USDT"
Binance: "ETHBTC"  ←→ Normalized: "ETH/BTC"
```

Any method that accepts a `NormalizedSymbol` validates the format first, then converts to
the Binance exchange symbol before making the API call. The conversion is reversible:
order responses contain the Binance symbol which is converted back to normalized.

---

## Order Status Mapping

| Binance status | Normalized |
|----------------|-----------|
| `NEW` | `OrderStatus.NEW` |
| `PARTIALLY_FILLED` | `OrderStatus.PARTIALLY_FILLED` |
| `FILLED` | `OrderStatus.FILLED` |
| `CANCELED` (single L — Binance typo) | `OrderStatus.CANCELLED` |
| `PENDING_CANCEL` | `OrderStatus.PENDING_CANCEL` |
| `REJECTED` | `OrderStatus.REJECTED` |
| `EXPIRED` | `OrderStatus.EXPIRED` |
| `EXPIRED_IN_MATCH` | `OrderStatus.EXPIRED` |
| Unknown future statuses | `OrderStatus.UNKNOWN` |

---

## Failure Recovery

| Scenario | Recovery |
|----------|----------|
| Network partition | Retry with exponential backoff → circuit opens → fast-fail until recovery |
| Binance maintenance | `ExchangeMaintenanceError` returned; circuit opens; health check reports `degraded` |
| Clock drift | `-1021` error triggers re-sync of server time offset |
| Rate limit hit | Pre-flight check prevents hitting the limit; if hit, `RateLimitError` with `retryAfterMs` |
| Invalid signature | `AuthenticationError` (non-retryable) — check API key and system clock |
| Duplicate clientOrderId | `ExchangeDuplicateOrderError` — safe to query existing order by clientOrderId |

---

## Scope of Milestone 5

| Feature | Status |
|---------|--------|
| All REST endpoints (ping, time, exchangeInfo, ticker, orderBook, trades, account, orders) | Implemented |
| Pre-submission order validation | Implemented |
| Rate limit tracking and enforcement | Implemented |
| Server time synchronization | Implemented |
| HMAC-SHA256 request signing | Implemented |
| Connection pooling (HTTPS keep-alive agent) | Implemented |
| Circuit breaker | Implemented |
| Exponential backoff retry | Implemented |
| Normalized error hierarchy | Implemented |
| Health provider | Implemented |
| WebSocket streaming | Deferred to Milestone 6 |
| Binance Futures (USDT-M, COIN-M) | Separate adapter, future milestone |
| Batch orders | Not implemented (capabilities flag: false) |
| OCO orders | Not implemented (capabilities flag: true, but no order type enum) |

---

## Adding This Module to the Application

```typescript
// src/app/app.module.ts
import { BinanceModule } from '@modules/exchange/adapters/binance/binance.module';

@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    MetricsModule,
    InfrastructureModule,
    HealthModule,
    BinanceModule,   // ← add here
  ],
})
export class AppModule {}
```

Set environment variables:
```
BINANCE_SPOT_API_KEY=your-api-key
BINANCE_SPOT_SECRET_KEY=your-secret-key
BINANCE_SPOT_TESTNET=true  # use testnet.binance.vision for testing
```

The adapter is initialized lazily when `ExchangeFactory.create({ exchangeId: ExchangeId.BINANCE_SPOT })`
is first called. Business modules never import BinanceModule or any Binance-specific class.
