import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { StreamPublisherService } from '@infrastructure/redis/streams/stream-publisher.service';
import { ExchangeModule } from '@modules/exchange/exchange.module';
import { RiskModule } from '@modules/risk/risk.module';
import { AlertsModule } from '@modules/alerts/alerts.module';
import { AdapterRegistry } from '@modules/exchange/adapters/adapter-registry';
import { MarketDataEventBus } from '@modules/exchange/market-data-event-bus';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { PaperTradingConfig } from '@config/paper-trading.config';

// Infrastructure
import { PaperStateStoreService } from './infrastructure/store/paper-state-store.service';
import { PaperExchangeAdapter } from './infrastructure/adapters/paper-exchange.adapter';

// Application services
import { PaperAccountService } from './application/services/paper-account.service';
import { PaperFillEngineService } from './application/services/paper-fill-engine.service';
import { PaperOrderBookService } from './application/services/paper-order-book.service';
import { PaperPositionManagerService } from './application/services/paper-position-manager.service';
import { PaperPortfolioManagerService } from './application/services/paper-portfolio-manager.service';
import { PaperReportService } from './application/services/paper-report.service';
import { PaperFundingService } from './application/services/paper-funding.service';

/**
 * PaperTradingModule provides a complete paper trading backend that mirrors
 * live trading without touching any real money or exchange accounts.
 *
 * On init (when enabled):
 *  1. Registers PaperExchangeAdapter in the ExchangeModule's AdapterRegistry
 *     under ExchangeId.PAPER_TRADING.
 *  2. All execution decisions whose signal.exchange === 'paper_trading' will
 *     be routed to this adapter by OrderRouterService.
 *  3. No strategy code changes are needed to switch between paper and live —
 *     only the exchange field in the strategy's signal metadata changes.
 *
 * Switching paper → live:
 *   Change PAPER_TRADING_ENABLED=false and update strategy exchange target
 *   to a real ExchangeId (e.g. 'binance_futures_usdt').
 *
 * Stream isolation:
 *   Live fills:  EXECUTION_REPORT → POSITION_UPDATE → PORTFOLIO_UPDATE
 *   Paper fills: EXECUTION_REPORT (exchangeId=paper_trading, filtered)
 *                → PAPER_POSITION_UPDATE → PAPER_PORTFOLIO_UPDATE
 *
 * The live PositionManagerService is patched to skip paper fills (see module).
 */
@Module({
  imports: [ExchangeModule, RiskModule, AlertsModule],
  providers: [
    // Infrastructure
    PaperStateStoreService,

    // Application
    PaperAccountService,
    PaperFillEngineService,
    PaperOrderBookService,
    PaperPositionManagerService,
    PaperPortfolioManagerService,
    PaperReportService,
    PaperFundingService,

    // Adapter factory — constructed in onModuleInit after DI is ready
    {
      provide: PaperExchangeAdapter,
      useFactory: (
        logger: AppLoggerService,
        publisher: StreamPublisherService,
        store: PaperStateStoreService,
        account: PaperAccountService,
        fillEngine: PaperFillEngineService,
        orderBook: PaperOrderBookService,
        marketDataBus: MarketDataEventBus,
      ): PaperExchangeAdapter =>
        new PaperExchangeAdapter(
          logger,
          publisher,
          store,
          account,
          fillEngine,
          orderBook,
          marketDataBus,
        ),
      inject: [
        AppLoggerService,
        StreamPublisherService,
        PaperStateStoreService,
        PaperAccountService,
        PaperFillEngineService,
        PaperOrderBookService,
        MarketDataEventBus,
      ],
    },
  ],
  exports: [
    PaperStateStoreService,      // needed by AnalyticsDataCollectorService
    PaperReportService,
    PaperPortfolioManagerService,
    PaperAccountService,
    PaperOrderBookService,       // needed by MonitoringModule (pending orders query)
    PaperExchangeAdapter,
  ],
})
export class PaperTradingModule implements OnModuleInit {
  private readonly context = PaperTradingModule.name;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
    private readonly registry: AdapterRegistry,
    private readonly adapter: PaperExchangeAdapter,
  ) {}

  async onModuleInit(): Promise<void> {
    const cfg = this.configService.get<PaperTradingConfig>('paperTrading')!;

    if (!cfg.enabled) {
      this.logger.warn(
        'Paper trading is DISABLED — set PAPER_TRADING_ENABLED=true to activate',
        this.context,
      );
      return;
    }

    // Register paper adapter so OrderRouterService can route to it
    if (!this.registry.has(ExchangeId.PAPER_TRADING)) {
      this.registry.register(ExchangeId.PAPER_TRADING, () => this.adapter);
    }

    // Initialize adapter (restores state from Redis, starts tick listener)
    const initResult = await this.adapter.initialize();
    if (initResult.isErr()) {
      this.logger.error(
        `Paper exchange adapter initialization failed: ${initResult.error.message}`,
        undefined,
        this.context,
      );
      return;
    }

    this.logger.log(
      `Paper trading ACTIVE — initialBalance=${cfg.initialBalanceUsd} USDT ` +
        `slippage=${cfg.slippageBps}bps latency=${cfg.latencyMs}ms ` +
        `maker=${cfg.makerCommissionBps}bps taker=${cfg.takerCommissionBps}bps`,
      this.context,
    );
  }
}
