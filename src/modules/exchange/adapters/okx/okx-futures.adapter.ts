import { ILogger } from '@core/logging/logger.interface';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { ExchangeCapabilities } from '@modules/exchange/models/exchange.models';
import { SymbolNormalizer } from '@modules/exchange/normalizers/symbol.normalizer';
import { OrderStatusNormalizer } from '@modules/exchange/normalizers/order-status.normalizer';
import { OrderValidator } from '@modules/exchange/validators/order.validator';
import { StubExchangeAdapter } from '@modules/exchange/adapters/stub-exchange.adapter';

/**
 * OkxFuturesAdapter — OKX perpetual swaps and delivery futures (instType=SWAP/FUTURES).
 *
 * REST base: https://www.okx.com
 * API docs: https://www.okx.com/docs-v5/en/#trading-account-rest-api-get-positions
 *
 * OKX derivatives features:
 *  - USDT-margined perpetuals (BTCUSDT-SWAP) and COIN-margined perpetuals (BTC-USD-SWAP)
 *  - Quarterly delivery futures (BTC-USD-YYMMDD)
 *  - Full algo order suite: TP/SL, trailing stop, conditional/trigger orders
 *  - Batch orders up to 20 per call
 *  - Reduce-only and post-only flags
 *  - Cross and isolated margin modes
 *  - Hedge mode (long + short simultaneously)
 *
 * This single adapter covers both SWAP (perpetual) and FUTURES (delivery).
 * The instType is resolved at request time from the symbol's settlement suffix.
 *
 * Status: STUB — all methods return ExchangeUnsupportedOperationError.
 */
export class OkxFuturesAdapter extends StubExchangeAdapter {
  readonly exchangeId = ExchangeId.OKX_FUTURES;

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
    supportsHedgeMode: true,
    supportsTrailingStop: true,
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
