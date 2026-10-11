import { IHistoricalDataReader } from '../interfaces/historical-data.interface';

/**
 * SdkInitContext is delivered to onInitialize() during the plugin's LOADED → INITIALIZED
 * transition. It provides enough information to set up internal data structures.
 *
 * No market data is available at this point — the strategy is not yet connected
 * to any live feed. Use this hook to allocate buffers, load static configuration,
 * and verify parameter correctness.
 *
 * strategyId  — the unique ID assigned to this strategy instance by the platform
 * symbol      — the primary trading symbol (e.g. "BTC/USDT")
 * exchange    — the exchange ID (e.g. "binance-spot")
 * parameters  — raw parameter object from the strategy's configuration, as provided
 *               by the platform administrator; strategy authors should cast and validate
 *               these in onInitialize() using their own type guard or validateConfig()
 */
export interface SdkInitContext {
  readonly strategyId: string;
  readonly symbol: string;
  readonly exchange: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

/**
 * SdkWarmupContext is delivered to onWarmup() during the INITIALIZED → WARMED_UP
 * transition. It provides historical data access for pre-loading indicator state.
 *
 * Use this hook to:
 *   - Load historical candles and seed internal indicator accumulators
 *   - Restore previous position state from execution reports
 *   - Validate that sufficient historical data is available
 *
 * After onWarmup() completes, the strategy transitions to WARMED_UP and starts
 * receiving live market events. The strategy MUST be ready to generate valid signals
 * immediately after warmup — the platform does not provide a grace period.
 *
 * historical — provides async access to the candle store; call getCandles() here,
 *              not during generateSignal() which has a strict runtime budget.
 */
export interface SdkWarmupContext {
  readonly strategyId: string;
  readonly symbol: string;
  readonly exchange: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly historical: IHistoricalDataReader;
}
