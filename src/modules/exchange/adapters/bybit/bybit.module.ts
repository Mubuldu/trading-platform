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
import { BybitConfig } from './config/bybit.config';
import { BYBIT_TOKENS } from './config/bybit.constants';
import { BybitSpotAdapter } from './bybit-spot.adapter';
import { BybitLinearAdapter } from './bybit-linear.adapter';
import { BybitInverseAdapter } from './bybit-inverse.adapter';

/**
 * BybitModule registers Bybit Spot, Linear, and Inverse adapters.
 *
 * All three adapters share one API key (Bybit V5 unified key) but target
 * different category endpoints. They are registered and enabled separately
 * so individual products can be disabled without affecting others.
 *
 * Current state: STUB adapters. All methods return ExchangeUnsupportedOperationError.
 * The module structure, config, and DI wiring are complete and production-ready.
 *
 * To enable Bybit in an application:
 *   1. Set BYBIT_API_KEY and BYBIT_SECRET_KEY in environment.
 *   2. Import BybitModule in AppModule.
 *   3. The registry auto-enables all three adapters on startup.
 *
 * To enable only specific products:
 *   Remove the enable() calls below for products you do not need,
 *   and call registry.enable(ExchangeId.BYBIT_LINEAR) elsewhere on demand.
 */
@Module({
  imports: [ExchangeModule],
  providers: [
    {
      provide: BYBIT_TOKENS.CONFIG,
      useFactory: (configService: ConfigService): BybitConfig =>
        configService.get<BybitConfig>('bybit')!,
      inject: [ConfigService],
    },
  ],
  exports: [],
})
export class BybitModule implements OnModuleInit {
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
      ExchangeId.BYBIT_SPOT,
      () =>
        new BybitSpotAdapter(
          this.logger,
          this.symbolNormalizer,
          this.orderStatusNormalizer,
          this.orderValidator,
        ),
    );

    this.registerAndEnable(
      ExchangeId.BYBIT_LINEAR,
      () =>
        new BybitLinearAdapter(
          this.logger,
          this.symbolNormalizer,
          this.orderStatusNormalizer,
          this.orderValidator,
        ),
    );

    this.registerAndEnable(
      ExchangeId.BYBIT_INVERSE,
      () =>
        new BybitInverseAdapter(
          this.logger,
          this.symbolNormalizer,
          this.orderStatusNormalizer,
          this.orderValidator,
        ),
    );
  }

  /**
   * Register with AdapterRegistry (for ExchangeFactory compatibility) and
   * with ExchangeRegistry (for ExchangeRouter capability-based routing).
   */
  private registerAndEnable(
    exchangeId: ExchangeId,
    creator: () => BybitSpotAdapter | BybitLinearAdapter | BybitInverseAdapter,
  ): void {
    this.adapterRegistry.register(exchangeId, creator);
    this.exchangeRegistry.enable(exchangeId);
    this.logger.log(`Bybit adapter registered and enabled: ${exchangeId}`, BybitModule.name);
  }
}
