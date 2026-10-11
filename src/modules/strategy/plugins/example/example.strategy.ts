import { MarketTick, Trade } from '@modules/exchange/models/market.models';
import { ExecutionReport } from '@modules/exchange/models/trading.models';
import { Position } from '@modules/exchange/models/account.models';
import { Candle } from '@modules/indicator/domain/models/candle.model';
import { BaseStrategy } from '../../framework/base-strategy';
import { StrategyContext, StrategyPluginConfig } from '../../interfaces/strategy.interface';
import { Signal } from '../../interfaces/signal.interface';

export const EXAMPLE_STRATEGY_TYPE = 'example';

export function createExampleConfig(
  overrides: Partial<StrategyPluginConfig> = {},
): StrategyPluginConfig {
  return {
    strategyId: 'example-v1',
    name: 'Example Strategy',
    version: '1.0.0',
    parameters: {},
    riskProfile: {
      maxPositionSizePercent: 1,
      maxDrawdownPercent: 5,
      stopLossPercent: 2,
      takeProfitPercent: 4,
      maxOpenOrders: 1,
    },
    enabledSymbols: ['BTC/USDT'],
    enabledSessions: [],
    resourceLimits: {
      maxRuntimeMs: 1_000,
      maxEventsPerSecond: 50,
    },
    ...overrides,
  };
}

/**
 * ExampleStrategy is a placeholder that satisfies the plugin contract.
 *
 * It logs every lifecycle event and always returns null from generateSignal.
 * Use it as a copy-paste starting point for real strategies — override only
 * the hooks your strategy needs.
 */
export class ExampleStrategy extends BaseStrategy {
  constructor(config: StrategyPluginConfig) {
    super(config);
  }

  protected override async onInitialize(): Promise<void> {
    // nothing to initialize
  }

  protected override async onWarmup(_context: StrategyContext): Promise<void> {
    // no warmup data needed — real strategies would load historical candles here
  }

  protected override async doOnTick(_tick: MarketTick): Promise<void> {
    // real strategies would update their internal state here
  }

  protected override async doOnTrade(_trade: Trade): Promise<void> {
    // real strategies would update volume profiles or trade counters here
  }

  protected override async doOnCandle(_candle: Candle): Promise<void> {
    // real strategies would recalculate indicator states here
  }

  protected override async doGenerateSignal(_context: StrategyContext): Promise<Signal | null> {
    // ExampleStrategy never generates signals — it is a placeholder only
    return null;
  }

  protected override async doOnOrderFilled(_report: ExecutionReport): Promise<void> {
    // real strategies would update position tracking here
  }

  protected override async doOnOrderRejected(_report: ExecutionReport): Promise<void> {
    // real strategies would apply rejection backoff logic here
  }

  protected override async doOnPositionOpened(_position: Position): Promise<void> {
    // real strategies would start tracking position metrics here
  }

  protected override async doOnPositionClosed(_position: Position): Promise<void> {
    // real strategies would record PnL and reset internal state here
  }

  protected override async onShutdown(): Promise<void> {
    // real strategies would flush buffers and cancel pending orders here
  }
}
