import { ILogger } from '@core/logging/logger.interface';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { ExchangeCapabilities } from '@modules/exchange/models/exchange.models';
import { SymbolNormalizer } from '@modules/exchange/normalizers/symbol.normalizer';
import { OrderStatusNormalizer } from '@modules/exchange/normalizers/order-status.normalizer';
import { OrderValidator } from '@modules/exchange/validators/order.validator';
import { StubExchangeAdapter } from '@modules/exchange/adapters/stub-exchange.adapter';

/**
 * BinanceFuturesUsdtAdapter — Binance USDT-margined perpetual & futures markets.
 *
 * Endpoint family: /fapi/v1/* and /fapi/v2/*
 * API docs: https://binance-docs.github.io/apidocs/futures/en/
 *
 * Status: STUB — registers capabilities and declares exchange identity.
 * All trading and market data methods return ExchangeUnsupportedOperationError
 * until this adapter is fully implemented.
 *
 * Implementation checklist (follow adapter-guide.md):
 *  [ ] BinanceFuturesRestClient (fapi base URL)
 *  [ ] initializeInternal(): fetch /fapi/v1/exchangeInfo, seed SymbolNormalizer
 *  [ ] Position, leverage, margin mode endpoints
 *  [ ] USDT-margined order submission and lifecycle
 *  [ ] Funding rate subscriptions via /fapi/v1/premiumIndex WebSocket
 *  [ ] Mark price subscriptions
 *  [ ] Hedge mode (dual position side) support
 */
export class BinanceFuturesUsdtAdapter extends StubExchangeAdapter {
  readonly exchangeId = ExchangeId.BINANCE_FUTURES_USDT;

  readonly capabilities: ExchangeCapabilities = {
    // Market types
    supportsSpot: false,
    supportsPerpetual: true,
    supportsFutures: true,
    supportsOptions: false,
    supportsMargin: false,
    supportsCrossMargin: true,
    supportsIsolatedMargin: true,
    // Order features
    supportsOco: false,
    supportsTpSl: true,
    supportsBatchOrders: true,
    supportsReduceOnly: true,
    supportsHedgeMode: true,
    supportsTrailingStop: true,
    supportsPostOnly: true,
    supportsConditionalOrders: true,
    supportsWebSocket: true,
    maxBatchOrderSize: 5,
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
