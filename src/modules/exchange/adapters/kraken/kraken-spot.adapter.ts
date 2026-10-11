import { ILogger } from '@core/logging/logger.interface';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { ExchangeCapabilities } from '@modules/exchange/models/exchange.models';
import { SymbolNormalizer } from '@modules/exchange/normalizers/symbol.normalizer';
import { OrderStatusNormalizer } from '@modules/exchange/normalizers/order-status.normalizer';
import { OrderValidator } from '@modules/exchange/validators/order.validator';
import { StubExchangeAdapter } from '@modules/exchange/adapters/stub-exchange.adapter';

/**
 * KrakenSpotAdapter — Kraken Spot market.
 *
 * REST base: https://api.kraken.com
 * API docs: https://docs.kraken.com/api/docs/rest-api
 *
 * Kraken Spot specifics:
 *  - Symbols use X/Z prefixes (XXBTZUSD); must be normalized via AssetPairs
 *  - WebSocket v2 uses simplified names ("XBT/USD") — separate mapping needed
 *  - Batch orders: up to 15 via AddOrderBatch
 *  - Post-only via userref + oflags=post flag
 *  - Conditional orders via trigger price (stop-loss, take-profit)
 *  - Kraken uses nonce-based authentication (incrementing integer)
 *
 * Note: Kraken Spot does NOT support perpetual contracts or hedge mode.
 * Use KrakenFuturesAdapter for leveraged derivatives.
 *
 * Status: STUB — all methods return ExchangeUnsupportedOperationError.
 */
export class KrakenSpotAdapter extends StubExchangeAdapter {
  readonly exchangeId = ExchangeId.KRAKEN_SPOT;

  readonly capabilities: ExchangeCapabilities = {
    supportsSpot: true,
    supportsPerpetual: false,
    supportsFutures: false,
    supportsOptions: false,
    supportsMargin: true, // Kraken supports margin trading on spot pairs
    supportsCrossMargin: true,
    supportsIsolatedMargin: false,
    supportsOco: false,
    supportsTpSl: true,
    supportsBatchOrders: true,
    supportsReduceOnly: false,
    supportsHedgeMode: false,
    supportsTrailingStop: false,
    supportsPostOnly: true,
    supportsConditionalOrders: true,
    supportsWebSocket: true,
    maxBatchOrderSize: 15,
  };

  constructor(
    logger: ILogger,
    symbolNormalizer: SymbolNormalizer,
    orderStatusNormalizer: OrderStatusNormalizer,
    orderValidator: OrderValidator,
  ) {
    super(logger, symbolNormalizer, orderStatusNormalizer, orderValidator);
  }
}
