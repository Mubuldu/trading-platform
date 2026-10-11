import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExchangeModule } from '@modules/exchange/exchange.module';
import { MarketDataEventBus } from '@modules/exchange/market-data-event-bus';
import { AdapterRegistry } from '@modules/exchange/adapters/adapter-registry';
import { SymbolNormalizer } from '@modules/exchange/normalizers/symbol.normalizer';
import { OrderStatusNormalizer } from '@modules/exchange/normalizers/order-status.normalizer';
import { OrderValidator } from '@modules/exchange/validators/order.validator';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { HealthCheckRegistry } from '@infrastructure/health/health-check-registry';
import { BinanceSpotAdapter } from './binance-spot.adapter';
import { BinanceRestClient } from './client/binance-rest.client';
import { BinanceSignatureService } from './auth/binance-signature.service';
import { BinanceServerTimeService } from './server-time/binance-server-time.service';
import { BinanceRateLimitManager } from './rate-limit/binance-rate-limit.manager';
import { BinanceErrorMapper } from './mappers/binance-error.mapper';
import { BinanceExchangeInfoMapper } from './mappers/binance-exchange-info.mapper';
import { BinanceOrderMapper } from './mappers/binance-order.mapper';
import { BinanceTicker24hrMapper } from './mappers/binance-ticker.mapper';
import { BinanceOrderBookMapper } from './mappers/binance-order-book.mapper';
import { BinanceTradeMapper } from './mappers/binance-trade.mapper';
import { BinanceAccountMapper } from './mappers/binance-account.mapper';
import { BinanceHealthProvider } from './health/binance-health.provider';
import { BinanceWsTickerMapper } from './ws/mappers/binance-ws-ticker.mapper';
import { BinanceWsOrderBookMapper } from './ws/mappers/binance-ws-order-book.mapper';
import { BinanceWsTradeMapper } from './ws/mappers/binance-ws-trade.mapper';
import { BinanceWsMessageNormalizer } from './ws/binance-ws-message-normalizer';
import { BinanceWsStreamManager, BinanceWsStreamConfig } from './ws/binance-ws-stream-manager';
import { BINANCE_TOKENS } from './config/binance.constants';
import { BinanceSpotConfig } from './config/binance.config';

/**
 * BinanceModule provides the Binance Spot REST + WebSocket adapter.
 *
 * On initialization (onModuleInit), it:
 *  1. Creates BinanceSpotConfig from environment variables
 *  2. Registers all Binance-specific services as NestJS providers
 *  3. Registers a BinanceSpotAdapter factory with the AdapterRegistry
 *  4. Registers BinanceHealthProvider with the HealthCheckRegistry
 *
 * To enable Binance in an application:
 *   1. Set the required environment variables (see env.validation.ts)
 *   2. Import BinanceModule in AppModule
 *
 * The module is NOT global — only modules that explicitly import it
 * gain access to Binance-specific services.
 */
@Module({
  imports: [ExchangeModule],
  providers: [
    {
      provide: BINANCE_TOKENS.CONFIG,
      useFactory: (configService: ConfigService): BinanceSpotConfig =>
        configService.get<BinanceSpotConfig>('binance')!,
      inject: [ConfigService],
    },
    // REST services
    BinanceSignatureService,
    BinanceServerTimeService,
    BinanceRateLimitManager,
    BinanceErrorMapper,
    BinanceExchangeInfoMapper,
    BinanceOrderMapper,
    BinanceTicker24hrMapper,
    BinanceOrderBookMapper,
    BinanceTradeMapper,
    BinanceAccountMapper,
    BinanceRestClient,
    BinanceHealthProvider,
    // WebSocket services
    BinanceWsTickerMapper,
    BinanceWsOrderBookMapper,
    BinanceWsTradeMapper,
    BinanceWsMessageNormalizer,
    {
      provide: BinanceWsStreamManager,
      useFactory: (
        config: BinanceSpotConfig,
        normalizer: BinanceWsMessageNormalizer,
        eventBus: MarketDataEventBus,
        logger: AppLoggerService,
      ): BinanceWsStreamManager => {
        const wsConfig: BinanceWsStreamConfig = {
          wsBaseUrl: config.wsBaseUrl,
          heartbeatIntervalMs: config.wsHeartbeatIntervalMs,
          heartbeatTimeoutMs: config.wsHeartbeatTimeoutMs,
          missedHeartbeatsThreshold: config.wsMissedHeartbeatsThreshold,
          reconnectBaseDelayMs: config.wsReconnectBaseDelayMs,
          reconnectMaxDelayMs: config.wsReconnectMaxDelayMs,
          maxReconnectAttempts: config.wsMaxReconnectAttempts,
          reconnectStableThresholdMs: config.wsReconnectStableThresholdMs,
          maxStreams: config.wsMaxStreams,
          maxMessageSizeBytes: config.wsMaxMessageSizeBytes,
        };
        return new BinanceWsStreamManager(wsConfig, normalizer, eventBus, logger);
      },
      inject: [
        BINANCE_TOKENS.CONFIG,
        BinanceWsMessageNormalizer,
        MarketDataEventBus,
        AppLoggerService,
      ],
    },
  ],
  exports: [BinanceHealthProvider],
})
export class BinanceModule implements OnModuleInit {
  constructor(
    private readonly registry: AdapterRegistry,
    private readonly symbolNormalizer: SymbolNormalizer,
    private readonly orderStatusNormalizer: OrderStatusNormalizer,
    private readonly orderValidator: OrderValidator,
    private readonly logger: AppLoggerService,
    private readonly restClient: BinanceRestClient,
    private readonly serverTimeService: BinanceServerTimeService,
    private readonly rateLimitManager: BinanceRateLimitManager,
    private readonly exchangeInfoMapper: BinanceExchangeInfoMapper,
    private readonly orderMapper: BinanceOrderMapper,
    private readonly tickerMapper: BinanceTicker24hrMapper,
    private readonly orderBookMapper: BinanceOrderBookMapper,
    private readonly tradeMapper: BinanceTradeMapper,
    private readonly accountMapper: BinanceAccountMapper,
    private readonly wsStreamManager: BinanceWsStreamManager,
    private readonly healthProvider: BinanceHealthProvider,
    private readonly healthRegistry: HealthCheckRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      ExchangeId.BINANCE_SPOT,
      () =>
        new BinanceSpotAdapter(
          this.logger,
          this.symbolNormalizer,
          this.orderStatusNormalizer,
          this.orderValidator,
          this.restClient,
          this.serverTimeService,
          this.rateLimitManager,
          this.exchangeInfoMapper,
          this.orderMapper,
          this.tickerMapper,
          this.orderBookMapper,
          this.tradeMapper,
          this.accountMapper,
          this.wsStreamManager,
        ),
    );

    this.healthRegistry.register(this.healthProvider);
  }
}
