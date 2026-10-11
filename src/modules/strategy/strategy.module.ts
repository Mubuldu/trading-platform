import { Module, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { ExchangeModule } from '@modules/exchange/exchange.module';
import { MarketDataEventBus } from '@modules/exchange/market-data-event-bus';
import { MARKET_DATA_EVENTS } from '@modules/exchange/models/common.model';
import { Ticker } from '@modules/exchange/models/market.models';
import { MlModule } from '@modules/ml/ml.module';
import { MlSignalService } from '@modules/ml/application/services/ml-signal.service';
import { StrategyRegistryService } from './registry/strategy-registry.service';
import { StrategyLoaderService } from './loader/strategy-loader.service';
import { StrategySchedulerService } from './scheduler/strategy-scheduler.service';
import {
  ExampleStrategy,
  EXAMPLE_STRATEGY_TYPE,
  createExampleConfig,
} from './plugins/example/example.strategy';
import {
  TrendFollowingV1Strategy,
  TREND_FOLLOWING_V1_TYPE,
  createTrendFollowingV1Config,
} from './plugins/trend-following-v1/trend-following-v1.strategy';

@Module({
  imports: [ExchangeModule, MlModule],
  providers: [StrategyRegistryService, StrategyLoaderService, StrategySchedulerService],
  exports: [StrategyRegistryService, StrategyLoaderService, StrategySchedulerService],
})
export class StrategyModule implements OnModuleInit, OnModuleDestroy {
  private readonly context = StrategyModule.name;

  constructor(
    private readonly loader: StrategyLoaderService,
    private readonly registry: StrategyRegistryService,
    private readonly scheduler: StrategySchedulerService,
    private readonly marketDataBus: MarketDataEventBus,
    private readonly logger: AppLoggerService,
    private readonly mlSignal: MlSignalService,
  ) {}

  /**
   * Arrow function so `this` is bound correctly when used as an event listener.
   * Ticker extends MarketTick, so it satisfies dispatchTick's parameter type directly.
   */
  private readonly tickerHandler = (ticker: Ticker): void => {
    void this.scheduler.dispatchTick(ticker);
  };

  async onModuleInit(): Promise<void> {
    // Wire live ticker events → strategy doOnTick so strategies can track real-time price.
    // This was missing: dispatchTick() existed but was never called, causing livePrice to
    // stay null and the dashboard to show "waiting for tick…" indefinitely.
    this.marketDataBus.on(MARKET_DATA_EVENTS.TICKER_UPDATED, this.tickerHandler);

    this.loader.registerFactory(EXAMPLE_STRATEGY_TYPE, (config) => new ExampleStrategy(config));
    // The MlSignalService is captured in the factory closure so every TFV1 instance
    // shares the same HTTP client.  The service falls back gracefully when the sidecar
    // is unreachable — no changes needed in BacktestEngineService or the optimizer.
    //
    // Backtest instances get strategyId suffixed with _bt_<sessionId>.  We deliberately
    // skip ML injection for those: the backtest is meant to generate the TRAINING DATA
    // for the model (rule-based trades only), so scoring every flat candle against the
    // Python sidecar would add ~250 ms/call × 31 k candles ≈ 2 hours of wall-clock time
    // with zero benefit.  Live instances keep the real MlSignalService.
    this.loader.registerFactory(
      TREND_FOLLOWING_V1_TYPE,
      (config) =>
        new TrendFollowingV1Strategy(
          config,
          config.strategyId.includes('_bt_') ? undefined : this.mlSignal,
        ),
    );

    const { loaded, failed } = await this.loader.loadAll([
      { strategyType: EXAMPLE_STRATEGY_TYPE, config: createExampleConfig() },
      { strategyType: TREND_FOLLOWING_V1_TYPE, config: createTrendFollowingV1Config() },
    ]);

    if (loaded.length > 0) {
      this.logger.log(`Loaded strategies: [${loaded.join(', ')}]`, this.context);
    }
    for (const f of failed) {
      this.logger.error(
        `Failed to load strategy type "${f.strategyType}": ${f.reason}`,
        undefined,
        this.context,
      );
    }

    // Enable all successfully loaded strategies so the scheduler dispatches events to them.
    for (const strategyId of loaded) {
      const result = this.registry.enable(strategyId);
      if (result.isErr()) {
        this.logger.error(
          `Failed to enable strategy "${strategyId}": ${result.error.message}`,
          undefined,
          this.context,
        );
      } else {
        this.logger.log(`Strategy enabled: ${strategyId}`, this.context);
      }
    }
  }

  onModuleDestroy(): void {
    this.marketDataBus.off(MARKET_DATA_EVENTS.TICKER_UPDATED, this.tickerHandler);
  }
}
