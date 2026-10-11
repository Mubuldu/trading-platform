# Strategy Plugin Development Guide

## Overview

The Strategy Framework is a plugin system. The core application knows nothing about
individual trading strategies. Each strategy is an isolated plugin that extends
`BaseStrategy` and overrides only the hooks it needs.

---

## Lifecycle

Every strategy goes through the following states:

```
IDLE → LOADING → IDLE → WARMING_UP → RUNNING → SHUTDOWN
                   ↕
                 ERROR
```

| State         | Meaning                                                   |
|---------------|-----------------------------------------------------------|
| `IDLE`        | Instantiated, not yet warmed up                           |
| `LOADING`     | `initialize()` is running                                 |
| `VALIDATING`  | `loadConfiguration()` is running                          |
| `WARMING_UP`  | `warmup()` is running — loading historical context        |
| `RUNNING`     | Receiving live market events                              |
| `PAUSED`      | Temporarily disabled — events are skipped                 |
| `ERROR`       | A hook threw an unhandled exception                       |
| `SHUTDOWN`    | `shutdown()` completed — strategy will not receive events |

---

## Creating a Strategy

### 1. Extend `BaseStrategy`

```typescript
import { BaseStrategy } from '../framework/base-strategy';
import { StrategyPluginConfig, StrategyContext } from '../interfaces/strategy.interface';
import { Signal } from '../interfaces/signal.interface';
import { SignalDirection } from '../domain/enums/signal-direction.enum';
import { randomUUID } from 'crypto';

export class MyMomentumStrategy extends BaseStrategy {
  constructor(config: StrategyPluginConfig) {
    super(config);
  }

  protected override async doOnCandle(candle: Candle): Promise<void> {
    // Update internal state based on the new candle
  }

  protected override async doGenerateSignal(context: StrategyContext): Promise<Signal | null> {
    const confidence = this.computeConfidence(context);
    if (confidence < 0.7) return null;

    return {
      signalId: randomUUID(),
      timestamp: context.timestamp,
      strategyId: this.id,
      exchange: context.exchange,
      symbol: context.symbol,
      direction: SignalDirection.BUY,
      confidence,
      reason: 'momentum breakout',
      metadata: { /* your metadata */ },
    };
  }

  private computeConfidence(_context: StrategyContext): number {
    // Your logic here
    return 0;
  }
}
```

### 2. Define a Factory and Config Builder

```typescript
export const MY_STRATEGY_TYPE = 'my-momentum';

export function createMyStrategyConfig(symbol: string): StrategyPluginConfig {
  return {
    strategyId: `my-momentum:${symbol}`,
    name: 'My Momentum Strategy',
    version: '1.0.0',
    parameters: { lookback: 20 },
    riskProfile: {
      maxPositionSizePercent: 2,
      maxDrawdownPercent: 10,
      stopLossPercent: 3,
      takeProfitPercent: 6,
      maxOpenOrders: 1,
    },
    enabledSymbols: [symbol],
    enabledSessions: [],
    resourceLimits: {
      maxRuntimeMs: 500,
      maxEventsPerSecond: 100,
    },
  };
}
```

### 3. Register the Factory in a NestJS Module

```typescript
import { Module, OnModuleInit } from '@nestjs/common';
import { StrategyLoaderService } from '../loader/strategy-loader.service';
import { MY_STRATEGY_TYPE, MyMomentumStrategy, createMyStrategyConfig } from './my-momentum.strategy';

@Module({})
export class MyStrategiesModule implements OnModuleInit {
  constructor(private readonly loader: StrategyLoaderService) {}

  async onModuleInit(): Promise<void> {
    this.loader.registerFactory(
      MY_STRATEGY_TYPE,
      (config) => new MyMomentumStrategy(config),
    );

    await this.loader.loadAll([
      { strategyType: MY_STRATEGY_TYPE, config: createMyStrategyConfig('BTC/USDT') },
    ]);
  }
}
```

---

## Available Hooks

Override only the hooks your strategy needs. All default to no-ops.

| Hook                  | When called                                    | Use for                               |
|-----------------------|------------------------------------------------|---------------------------------------|
| `onInitialize()`      | Once at startup                                | Set up connections, load static data  |
| `onConfigurationLoaded()` | On load and on hot-reload               | Apply new parameter values            |
| `doValidateConfiguration()` | Before load and before reload         | Validate parameter ranges             |
| `onWarmup()`          | Before entering RUNNING state                  | Load historical candles for indicators|
| `doOnTick()`          | Every best bid/ask update                      | Real-time spread / quote tracking     |
| `doOnTrade()`         | Every public trade                             | Volume and momentum tracking          |
| `doOnCandle()`        | Every closed candle                            | Indicator recalculation               |
| `doGenerateSignal()`  | Scheduled by the Scheduler                     | Core signal logic                     |
| `doOnOrderFilled()`   | When your order gets fully or partially filled | Position tracking                     |
| `doOnOrderRejected()` | When your order is rejected                    | Backoff and retry logic               |
| `doOnPositionOpened()`| When a new position is opened                  | Start PnL tracking                    |
| `doOnPositionClosed()`| When a position is closed                      | Record result, reset state            |
| `onShutdown()`        | On graceful shutdown                           | Flush buffers, cancel open orders     |

---

## Utility Methods from BaseStrategy

```typescript
// Call inside doGenerateSignal or any hook to skip the event and count it
this.skip();

// Call inside onWarmup() to report progress (0.0 → 1.0)
this.setWarmupProgress(0.5);
```

---

## Configuration Reference

```typescript
interface StrategyPluginConfig {
  strategyId: string;       // Unique identifier — must be globally unique
  name: string;             // Human-readable display name
  version: string;          // SemVer string e.g. '1.2.0'
  parameters: Record<string, unknown>; // Strategy-specific tuning params
  riskProfile: {
    maxPositionSizePercent: number;  // Max position as % of account
    maxDrawdownPercent: number;      // Max allowed drawdown before auto-disable
    stopLossPercent: number;
    takeProfitPercent: number;
    maxOpenOrders: number;
    leverage?: number;               // Futures only
  };
  enabledSymbols: string[];    // e.g. ['BTC/USDT', 'ETH/USDT']
  enabledSessions: Array<{     // Empty = trade all sessions
    name: string;
    startHourUtc: number;      // 0-23
    endHourUtc: number;        // 0-23
  }>;
  resourceLimits: {
    maxRuntimeMs?: number;         // Default: 5000ms per hook call
    maxEventsPerSecond?: number;   // Default: 100
    maxCpuMs?: number;             // Advisory — logged but not enforced
    maxMemoryBytes?: number;       // Advisory — logged but not enforced
  };
}
```

---

## Hot Reload

Parameters can be updated without restarting the application. The registry's
`reload(strategyId, newConfig)` method:

1. Calls `validateConfiguration(newConfig)` — if invalid, the old config is kept
2. Calls `loadConfiguration(newConfig)` — your `onConfigurationLoaded()` fires
3. The strategy continues running with new parameters — no state reset

**What cannot be hot-reloaded:**
- `strategyId` — changing the ID requires unregistering and re-registering
- `version` — treat version changes as new deployments

---

## Isolation Contract

- Your strategy **must not** catch-and-swallow all errors silently. Let unexpected
  errors propagate — BaseStrategy catches them, records metrics, and transitions
  to ERROR state. The scheduler logs the error and moves on to the next strategy.
- Your strategy **must not** block indefinitely. Respect `resourceLimits.maxRuntimeMs`.
  The scheduler enforces this with `withTimeout` — a timeout exception will put
  your strategy in ERROR state.
- Your strategy **must not** share mutable state with other strategies. Each instance
  is independent.

---

## Best Practices

- Keep `doGenerateSignal()` fast and purely computational. Expensive I/O belongs
  in `doOnCandle()` or `doOnTick()` where you update internal state.
- Use `setWarmupProgress()` inside `onWarmup()` for multi-step warmups so the
  health endpoint reports accurate progress.
- Prefer returning `null` from `doGenerateSignal()` over returning `HOLD` signals —
  null means "no opinion" and is cheaper to process downstream.
- Validate all parameters in `doValidateConfiguration()` so hot-reload failures
  are caught before they affect running strategies.
- Always implement `onShutdown()` if you hold resources (connections, file handles).

---

## Extending the Framework

To add new hook types to the framework:

1. Add the method signature to `IStrategy` in `interfaces/strategy.interface.ts`
2. Add the default no-op implementation to `BaseStrategy` in `framework/base-strategy.ts`
3. Add the dispatcher method to `StrategySchedulerService`
4. Update this guide
