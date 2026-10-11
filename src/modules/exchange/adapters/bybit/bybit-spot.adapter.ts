import { ILogger } from '@core/logging/logger.interface';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { ExchangeCapabilities } from '@modules/exchange/models/exchange.models';
import { SymbolNormalizer } from '@modules/exchange/normalizers/symbol.normalizer';
import { OrderStatusNormalizer } from '@modules/exchange/normalizers/order-status.normalizer';
import { OrderValidator } from '@modules/exchange/validators/order.validator';
import { StubExchangeAdapter } from '@modules/exchange/adapters/stub-exchange.adapter';

/**
 * BybitSpotAdapter — Bybit Spot market (category=spot).
 *
 * REST base: https://api.bybit.com
 * API docs: https://bybit-exchange.github.io/docs/v5/market/instrument
 *
 * Bybit Spot supports:
 *  - Standard limit/market/stop orders
 *  - Post-only flag (guaranteed maker)
 *  - TP/SL (take-profit / stop-loss) attached to orders
 *  - Isolated margin on margin trading pairs
 *
 * Status: STUB — all methods return ExchangeUnsupportedOperationError.
 * Implement per the adapter guide in docs/exchange-adapter-guide.md.
 */
export class BybitSpotAdapter extends StubExchangeAdapter {
  readonly exchangeId = ExchangeId.BYBIT_SPOT;

  readonly capabilities: ExchangeCapabilities = {
    supportsSpot: true,
    supportsPerpetual: false,
    supportsFutures: false,
    supportsOptions: false,
    supportsMargin: true,
    supportsCrossMargin: false,
    supportsIsolatedMargin: true,
    supportsOco: false,
    supportsTpSl: true,
    supportsBatchOrders: false,
    supportsReduceOnly: false,
    supportsHedgeMode: false,
    supportsTrailingStop: false,
    supportsPostOnly: true,
    supportsConditionalOrders: false,
    supportsWebSocket: true,
    maxBatchOrderSize: 0,
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
