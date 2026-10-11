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
import { OkxConfig } from './config/okx.config';
import { OKX_TOKENS } from './config/okx.constants';
import { OkxSpotAdapter } from './okx-spot.adapter';
import { OkxFuturesAdapter } from './okx-futures.adapter';

/**
 * OkxModule registers OKX Spot and Futures (Swap/Delivery) adapters.
 *
 * OKX uses a single unified API key with three credentials:
 * apiKey, secretKey, and passphrase. The passphrase is required for all
 * authenticated requests and is set via OKX_PASSPHRASE in the environment.
 *
 * For demo / paper trading, set OKX_SIMULATED_TRADING=true; OKX enables
 * simulation via the x-simulated-trading: 1 request header — no URL change.
 *
 * Current state: STUB adapters.
 *
 * To enable OKX in an application:
 *   1. Set OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE in environment.
 *   2. Import OkxModule in AppModule.
 */
@Module({
  imports: [ExchangeModule],
  providers: [
    {
      provide: OKX_TOKENS.CONFIG,
      useFactory: (configService: ConfigService): OkxConfig => configService.get<OkxConfig>('okx')!,
      inject: [ConfigService],
    },
  ],
  exports: [],
})
export class OkxModule implements OnModuleInit {
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
      ExchangeId.OKX_SPOT,
      () =>
        new OkxSpotAdapter(
          this.logger,
          this.symbolNormalizer,
          this.orderStatusNormalizer,
          this.orderValidator,
        ),
    );

    this.registerAndEnable(
      ExchangeId.OKX_FUTURES,
      () =>
        new OkxFuturesAdapter(
          this.logger,
          this.symbolNormalizer,
          this.orderStatusNormalizer,
          this.orderValidator,
        ),
    );
  }

  private registerAndEnable(
    exchangeId: ExchangeId,
    creator: () => OkxSpotAdapter | OkxFuturesAdapter,
  ): void {
    this.adapterRegistry.register(exchangeId, creator);
    this.exchangeRegistry.enable(exchangeId);
    this.logger.log(`OKX adapter registered and enabled: ${exchangeId}`, OkxModule.name);
  }
}
