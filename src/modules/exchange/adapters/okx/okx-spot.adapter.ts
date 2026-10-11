import { ILogger } from '@core/logging/logger.interface';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { ExchangeCapabilities } from '@modules/exchange/models/exchange.models';
import { SymbolNormalizer } from '@modules/exchange/normalizers/symbol.normalizer';
import { OrderStatusNormalizer } from '@modules/exchange/normalizers/order-status.normalizer';
import { OrderValidator } from '@modules/exchange/validators/order.validator';
import { StubExchangeAdapter } from '@modules/exchange/adapters/stub-exchange.adapter';

/**
 * OkxSpotAdapter — OKX Spot market (instType=SPOT).
 *
 * REST base: https://www.okx.com
 * API docs: https://www.okx.com/docs-v5/en/#order-book-trading-market-data
 *
 * OKX Spot features:
 *  - Standard limit / market / post-only orders
 *  - TP/SL as attached algo orders
 *  - Conditional (trigger) orders via the algo order API
 *  - Batch order submission (up to 20 per request)
 *  - Cross and isolated margin on margin-enabled pairs (instType=MARGIN)
 *
 * Note: OKX separates SPOT and MARGIN into distinct instTypes.
 * This adapter covers pure spot trading (instType=SPOT).
 * Margin trading is implemented via supportsMargin=false here;
 * a future OkxMarginAdapter can handle instType=MARGIN separately.
 *
 * Status: STUB — all methods return ExchangeUnsupportedOperationError.
 */
export class OkxSpotAdapter extends StubExchangeAdapter {
  readonly exchangeId = ExchangeId.OKX_SPOT;

  readonly capabilities: ExchangeCapabilities = {
    supportsSpot: true,
    supportsPerpetual: false,
    supportsFutures: false,
    supportsOptions: false,
    supportsMargin: false,
    supportsCrossMargin: false,
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
    maxBatchOrderSize: 20,
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
