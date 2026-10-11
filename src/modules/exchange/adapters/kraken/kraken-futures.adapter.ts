import { ILogger } from '@core/logging/logger.interface';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { ExchangeCapabilities } from '@modules/exchange/models/exchange.models';
import { SymbolNormalizer } from '@modules/exchange/normalizers/symbol.normalizer';
import { OrderStatusNormalizer } from '@modules/exchange/normalizers/order-status.normalizer';
import { OrderValidator } from '@modules/exchange/validators/order.validator';
import { StubExchangeAdapter } from '@modules/exchange/adapters/stub-exchange.adapter';

/**
 * KrakenFuturesAdapter — Kraken Futures (perpetual + dated futures).
 *
 * REST base: https://futures.kraken.com
 * API docs: https://docs.kraken.com/api/docs/futures-api
 *
 * Kraken Futures is operated as a separate product (formerly CF Crypto
 * Facilities). It uses different credentials from Kraken Spot.
 *
 * Kraken Futures features:
 *  - Multi-collateral (USDT, XBT, ETH, USDC)
 *  - Perpetuals (PF_ prefix) and quarterly futures (FI_ prefix)
 *  - Flexible (cross) and fixed (isolated) margin
 *  - Reduce-only orders
 *  - Post-only flag
 *  - Batch order submission
 *
 * Symbols: PF_XBTUSD (perpetual), FI_XBTUSD_250328 (quarterly)
 *
 * Status: STUB — all methods return ExchangeUnsupportedOperationError.
 */
export class KrakenFuturesAdapter extends StubExchangeAdapter {
  readonly exchangeId = ExchangeId.KRAKEN_FUTURES;

  readonly capabilities: ExchangeCapabilities = {
    supportsSpot: false,
    supportsPerpetual: true,
    supportsFutures: true,
    supportsOptions: false,
    supportsMargin: false,
    supportsCrossMargin: true,
    supportsIsolatedMargin: true,
    supportsOco: false,
    supportsTpSl: true,
    supportsBatchOrders: true,
    supportsReduceOnly: true,
    supportsHedgeMode: false,
    supportsTrailingStop: false,
    supportsPostOnly: true,
    supportsConditionalOrders: false,
    supportsWebSocket: true,
    maxBatchOrderSize: 10,
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
