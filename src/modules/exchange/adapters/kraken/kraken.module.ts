import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExchangeModule } from '@modules/exchange/exchange.module';
import { AdapterRegistry } from '@modules/exchange/adapters/adapter-registry';
import { ExchangeRegistry } from '@modules/exchange/registry/exchange-registry';
import { SymbolNormalizer } from '@modules/exchange/normalizers/symbol.normalizer';
import { OrderStatusNormalizer } from '@modules/exchange/normalizers/order-status.normalizer';
import { OrderValidator } from '@modules/exchange/validators/order.validator';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { KrakenConfig } from './config/kraken.config';
import { KRAKEN_TOKENS } from './config/kraken.constants';
import { KrakenSpotAdapter } from './kraken-spot.adapter';
import { KrakenFuturesAdapter } from './kraken-futures.adapter';

/**
 * KrakenModule registers Kraken Spot and Kraken Futures adapters.
 *
 * Kraken Spot and Kraken Futures use separate REST hosts and separate API
 * credentials. Both are registered independently, allowing one to be enabled
 * while the other remains disabled.
 *
 * Current state: STUB adapters.
 *
 * To enable Kraken in an application:
 *   1. Set KRAKEN_SPOT_API_KEY + KRAKEN_SPOT_PRIVATE_KEY in environment.
 *   2. Set KRAKEN_FUTURES_API_KEY + KRAKEN_FUTURES_PRIVATE_KEY for futures.
 *   3. Import KrakenModule in AppModule.
 */
@Module({
  imports: [ExchangeModule],
  providers: [
    {
      provide: KRAKEN_TOKENS.CONFIG,
      useFactory: (configService: ConfigService): KrakenConfig =>
        configService.get<KrakenConfig>('kraken')!,
      inject: [ConfigService],
    },
  ],
  exports: [],
})
export class KrakenModule implements OnModuleInit {
  constructor(
    private readonly adapterRegistry: AdapterRegistry,
    private readonly exchangeRegistry: ExchangeRegistry,
    private readonly symbolNormalizer: SymbolNormalizer,
    private readonly orderStatusNormalizer: OrderStatusNormalizer,
    private readonly orderValidator: OrderValidator,
    private readonly logger: AppLoggerService,
  ) {}

  onModuleInit(): void {
    this.registerAndEnable(
      ExchangeId.KRAKEN_SPOT,
      () =>
        new KrakenSpotAdapter(
          this.logger,
          this.symbolNormalizer,
          this.orderStatusNormalizer,
          this.orderValidator,
        ),
    );

    this.registerAndEnable(
      ExchangeId.KRAKEN_FUTURES,
      () =>
        new KrakenFuturesAdapter(
          this.logger,
          this.symbolNormalizer,
          this.orderStatusNormalizer,
          this.orderValidator,
        ),
    );
  }

  private registerAndEnable(
    exchangeId: ExchangeId,
    creator: () => KrakenSpotAdapter | KrakenFuturesAdapter,
  ): void {
    this.adapterRegistry.register(exchangeId, creator);
    this.exchangeRegistry.enable(exchangeId);
    this.logger.log(`Kraken adapter registered and enabled: ${exchangeId}`, KrakenModule.name);
  }
}
