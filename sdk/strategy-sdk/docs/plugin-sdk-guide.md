# Strategy SDK — Plugin Author Guide

> **Version:** 1.0.0 · **Audience:** Strategy developers

---

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [The `PluginManifest`](#the-pluginmanifest)
4. [Strategy Lifecycle](#strategy-lifecycle)
5. [Context Interfaces](#context-interfaces)
6. [Writing Signals](#writing-signals)
7. [Permissions](#permissions)
8. [Configuration and Parameters](#configuration-and-parameters)
9. [Risk Limits](#risk-limits)
10. [Error Handling](#error-handling)
11. [Logging](#logging)
12. [Testing Your Strategy](#testing-your-strategy)
13. [Checklist Before Submission](#checklist-before-submission)

---

## Overview

The **Strategy SDK** is a zero-dependency TypeScript package that lets anyone write algorithmic trading strategies without needing access to—or even knowledge of—the platform's internals.

The dependency graph is strictly one-way:

```
Platform  ──→  SDK strategy
               (no reverse imports)
```

Your strategy lives entirely inside the SDK boundary. It receives read-only market snapshots and returns trade signals. Everything else—order routing, risk checks, position management—is the platform's responsibility.

---

## Quick Start

```bash
# Inside your strategy workspace
pnpm add @trading-platform/strategy-sdk
```

```typescript
// my-strategy.ts
import {
  SdkStrategy,
  PluginManifest,
  SdkStrategyContext,
  SdkSignal,
  SdkSignalDirection,
  StrategyPermission,
} from '@trading-platform/strategy-sdk';

export default class MyStrategy extends SdkStrategy {
  readonly manifest: PluginManifest = {
    id:                 'my-strategy-v1',
    name:               'My Strategy',
    version:            '1.0.0',
    author:             { name: 'Your Name', email: 'you@example.com' },
    license:            'MIT',
    description:        'One-sentence description of what this strategy does.',
    requiredSdkVersion: '^1.0.0',
    permissions:        [StrategyPermission.GENERATE_SIGNALS],
  };

  protected async generateSignal(ctx: SdkStrategyContext): Promise<SdkSignal | null> {
    const price = ctx.marketData.lastPrice();
    if (price === null) return null;

    // Your logic here …

    return null; // return null to pass this tick
  }
}
```

---

## The `PluginManifest`

Every strategy must expose a `readonly manifest` property conforming to `PluginManifest`. The platform validates it before the strategy is allowed to run.

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | ✅ | Lowercase, hyphens only, max 64 chars. Must be globally unique. Use a `v<N>` suffix for versioned IDs, e.g. `sma-crossover-v1`. |
| `name` | `string` | ✅ | Human-readable display name. |
| `version` | `string` | ✅ | Exact semver: `MAJOR.MINOR.PATCH`. |
| `author.name` | `string` | ✅ | Author or organisation name. |
| `author.email` | `string` | ❌ | Contact email. |
| `author.url` | `string` | ❌ | Author homepage (`https://` only). |
| `license` | `string` | ✅ | SPDX identifier, e.g. `MIT`. |
| `description` | `string` | ✅ | One-sentence description. |
| `requiredSdkVersion` | `string` | ✅ | Semver range (no wildcards). |
| `permissions` | `StrategyPermission[]` | ✅ | Must include `GENERATE_SIGNALS`. |
| `dependencies` | `Dependency[]` | ❌ | Declared runtime dependencies. |
| `riskLimits` | `ManifestRiskLimits` | ❌ | Per-call CPU/event budgets. |
| `homepage` | `string` | ❌ | Strategy documentation URL (`https://` only). |

### Manifest validation rules

- `id` must match `/^[a-z0-9][a-z0-9\-]{0,62}[a-z0-9]$/`
- `version` must be exact semver (no range operators)
- `requiredSdkVersion` must be a non-wildcard semver range (`^`, `~`, `>=`, or exact match)
- `permissions` must contain `GENERATE_SIGNALS`
- All values in `permissions` must be known `StrategyPermission` members

---

## Strategy Lifecycle

The platform drives your strategy through a well-defined state machine:

```
REGISTERED → VALIDATED → LOADED → INITIALIZED → WARMED_UP → RUNNING ↔ PAUSED
                                                                        ↓
                                                                    UNLOADED → REMOVED
                                                     (any state) → ERROR
```

### Hooks you can override

```typescript
class SdkStrategy {
  // Optional hooks — override only what you need

  validateConfig(parameters: Record<string, unknown>): SdkResult<void>
  onInitialize(ctx: SdkInitContext): Promise<void>
  onWarmup(ctx: SdkWarmupContext): Promise<void>
  onStart(): Promise<void>
  onStop(): Promise<void>
  onOrderFilled(report: SdkExecutionReport): Promise<void>
  onOrderRejected(report: SdkExecutionReport): Promise<void>
  onPositionUpdate(position: SdkOpenPosition | null): Promise<void>

  // Required – the core signal logic
  protected abstract generateSignal(ctx: SdkStrategyContext): Promise<SdkSignal | null>
}
```

### Hook contracts

| Hook | When called | Typical use |
|---|---|---|
| `validateConfig` | Before `INITIALIZED` | Validate user parameters; return an error to block install |
| `onInitialize` | `LOADED → INITIALIZED` | Apply parameters, allocate indicator buffers |
| `onWarmup` | `INITIALIZED → WARMED_UP` | Fetch historical data, pre-fill indicators |
| `onStart` | `WARMED_UP → RUNNING` | Reset per-session state |
| `generateSignal` | Every tick while `RUNNING` | Core logic – return a signal or `null` |
| `onOrderFilled` | After a fill | Update internal state |
| `onOrderRejected` | After a rejection | Log and adjust |
| `onPositionUpdate` | Position opened/closed | Track open position state |
| `onStop` | `RUNNING/PAUSED → UNLOADED` | Flush buffers, cancel pending work |

---

## Context Interfaces

### `SdkInitContext`

Available in `onInitialize()`:

```typescript
interface SdkInitContext {
  readonly strategyId: string;
  readonly symbol:     string;   // e.g. 'BTC/USDT'
  readonly exchange:   string;   // e.g. 'binance-futures'
  readonly parameters: Readonly<Record<string, unknown>>;
}
```

### `SdkWarmupContext`

Available in `onWarmup()` — adds historical data access:

```typescript
interface SdkWarmupContext extends SdkInitContext {
  readonly historical: HistoricalDataReader;
}

interface HistoricalDataReader {
  getCandles(request: HistoricalCandleRequest): Promise<SdkCandle[]>;
}
```

### `SdkStrategyContext`

Available in `generateSignal()` — gated by permissions:

```typescript
interface SdkStrategyContext {
  readonly marketData:      ReadonlyMarketData | null;
  readonly indicators:      ReadonlyIndicators | null;
  readonly portfolio:       ReadonlyPortfolio | null;
  readonly riskState:       ReadonlyRiskState | null;
  readonly executionReports: ReadonlyExecutionReports | null;
}
```

If a required permission is missing, the corresponding field is `null` and any method call on it throws `PermissionDeniedError`.

---

## Writing Signals

Return a `SdkSignal` to request a trade, or `null` to skip this tick.

```typescript
interface SdkSignal {
  direction:    SdkSignalDirection;   // 'long' | 'short' | 'close'
  strength:     number;               // 0.0 – 1.0 (confidence)
  reason:       string;               // Human-readable rationale
  metadata?:    Record<string, unknown>;
}
```

### Example

```typescript
protected async generateSignal(ctx: SdkStrategyContext): Promise<SdkSignal | null> {
  const price = ctx.marketData?.lastPrice();
  if (price === null || price === undefined) return null;

  if (this.fastMa > this.slowMa && !this.inLong) {
    return {
      direction: SdkSignalDirection.LONG,
      strength:  0.8,
      reason:    'Fast MA crossed above slow MA',
    };
  }

  return null;
}
```

### Rules

- Return `null` to do nothing; the platform ignores it
- Signal `strength` should reflect your model's confidence (0 = no conviction, 1 = maximum)
- Do **not** call exchange APIs or manage orders yourself — the platform handles execution
- Keep `generateSignal` fast: it runs on every market tick

---

## Permissions

Declare every data source your strategy needs in `manifest.permissions`. The platform only provides access to what is declared; everything else is blocked at runtime.

| Permission | Unlocks |
|---|---|
| `GENERATE_SIGNALS` | Required for all strategies. Allows returning signals. |
| `READ_MARKET_DATA` | `ctx.marketData` — price, order book, recent trades |
| `READ_INDICATORS` | `ctx.indicators` — OHLCV candles, built-in indicators |
| `READ_PORTFOLIO` | `ctx.portfolio` — balances, open positions |
| `READ_RISK_STATE` | `ctx.riskState` — drawdown, daily loss |
| `READ_EXECUTION_REPORTS` | `ctx.executionReports` — fill and rejection history |
| `ACCESS_HISTORICAL_DATA` | `ctx.historical` in `onWarmup()` |

Requesting unused permissions will not cause errors, but the platform may flag it during review.

---

## Configuration and Parameters

User-supplied configuration arrives in `ctx.parameters` during `onInitialize()` and `onWarmup()`. Always apply defensive defaults:

```typescript
interface MyParams {
  period:    number;
  threshold: number;
}

const DEFAULTS: MyParams = { period: 20, threshold: 0.02 };

protected async onInitialize(ctx: SdkInitContext): Promise<void> {
  const p = ctx.parameters as Partial<MyParams>;
  this.params = {
    period:    typeof p.period    === 'number' ? p.period    : DEFAULTS.period,
    threshold: typeof p.threshold === 'number' ? p.threshold : DEFAULTS.threshold,
  };
}
```

### `validateConfig`

Validate parameter types and ranges before the strategy is accepted:

```typescript
validateConfig(params: Record<string, unknown>): SdkResult<void> {
  const p = params as Partial<MyParams>;
  if (typeof p.period !== 'number' || p.period < 2) {
    return sdkErr(new SdkValidationError('period must be a number >= 2'));
  }
  return sdkOk(undefined);
}
```

---

## Risk Limits

Declare resource budgets in `manifest.riskLimits`. The sandbox enforces them:

```typescript
riskLimits: {
  maxRuntimeMs:          500,   // Max wall-clock ms per generateSignal() call
  maxEventsPerSecond:    100,   // Calls/second before the sandbox drops excess
  maxPositionSizePercent: 2,    // Optional: cap single-position size
  maxDrawdownPercent:     10,   // Optional: circuit-breaker drawdown
  maxOpenOrders:         3,     // Optional: concurrent open orders
}
```

When `maxRuntimeMs` is exceeded the sandbox resolves the call with `null` and logs a warning. When `maxEventsPerSecond` is breached, excess calls return `null` immediately without entering your code.

---

## Error Handling

### Inside hooks

Throw a plain `Error` if something unrecoverable happens during `onInitialize()` or `onWarmup()`:

```typescript
protected async onInitialize(ctx: SdkInitContext): Promise<void> {
  if (this.params.period < 2) {
    throw new Error(`period must be >= 2, got ${this.params.period}`);
  }
}
```

The platform catches the error, transitions the plugin to `ERROR` state, and surfaces it in the health dashboard. The strategy will not receive further ticks.

### Inside `generateSignal`

Do **not** throw from `generateSignal`. Return `null` instead when conditions are not met. Unhandled throws are caught by the sandbox and logged, but the call counts against your rate limit.

### `SdkResult`

Use `SdkResult<T>` for functions that can fail without being exceptional:

```typescript
import { sdkOk, sdkErr, SdkResult, SdkValidationError } from '@trading-platform/strategy-sdk';

function divide(a: number, b: number): SdkResult<number> {
  if (b === 0) return sdkErr(new SdkValidationError('division by zero'));
  return sdkOk(a / b);
}
```

---

## Logging

Use `this.log(message)` inside any hook — messages are forwarded to the platform's structured logger at `DEBUG` level, tagged with your strategy ID:

```typescript
protected async onInitialize(ctx: SdkInitContext): Promise<void> {
  this.log(`Initializing for ${ctx.symbol} on ${ctx.exchange}`);
}
```

**Do not** use `console.log`, `process.stdout`, or any external logging library. The platform blocks those APIs.

---

## Testing Your Strategy

The SDK ships with helpers designed for unit tests. You don't need to spin up the full platform.

```typescript
// my-strategy.spec.ts
import MyStrategy from './my-strategy';
import { SdkStrategyContext, SdkSignalDirection } from '@trading-platform/strategy-sdk';

function mockCtx(lastPrice: number): SdkStrategyContext {
  return {
    marketData: { lastPrice: () => lastPrice } as unknown as ReadonlyMarketData,
    indicators: null,
    portfolio:  null,
    riskState:  null,
    executionReports: null,
  };
}

describe('MyStrategy', () => {
  let strategy: MyStrategy;

  beforeEach(async () => {
    strategy = new MyStrategy();
    await strategy['onInitialize']({ strategyId: 'test', symbol: 'BTC/USDT', exchange: 'binance', parameters: {} });
  });

  it('returns null when conditions are not met', async () => {
    const signal = await strategy['generateSignal'](mockCtx(50_000));
    expect(signal).toBeNull();
  });
});
```

### Tips

- Test every branch of `generateSignal` in isolation — it should be a pure function of its context
- Mock `ctx.marketData`, `ctx.indicators`, etc. with plain objects
- Test `validateConfig` with boundary values
- Test `onInitialize` with missing/invalid parameters to confirm fallback to defaults

---

## Checklist Before Submission

- [ ] `manifest.id` is lowercase, hyphenated, globally unique
- [ ] `manifest.requiredSdkVersion` is a proper semver range (not `*`)
- [ ] All required permissions are declared
- [ ] `validateConfig` rejects invalid parameter types and out-of-range values
- [ ] `onInitialize` always applies defensive defaults for all parameters
- [ ] `generateSignal` never throws — returns `null` on missing/invalid data
- [ ] No `process.env`, `require`, `import()`, `fs`, `eval`, or `new Function` usage
- [ ] No outbound HTTP calls
- [ ] `this.log()` is used instead of `console.log`
- [ ] Unit tests cover all signal branches and parameter edge cases
