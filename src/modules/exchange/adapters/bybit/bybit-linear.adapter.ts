import { ILogger } from '@core/logging/logger.interface';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { ExchangeCapabilities } from '@modules/exchange/models/exchange.models';
import { SymbolNormalizer } from '@modules/exchange/normalizers/symbol.normalizer';
import { OrderStatusNormalizer } from '@modules/exchange/normalizers/order-status.normalizer';
import { OrderValidator } from '@modules/exchange/validators/order.validator';
import { StubExchangeAdapter } from '@modules/exchange/adapters/stub-exchange.adapter';

/**
 * BybitLinearAdapter — Bybit USDT-margined perpetuals and futures (category=linear).
 *
 * "Linear" = USDT-margined contracts. P&L and collateral are in USDT.
 * Symbols: BTCUSDT, ETHUSDT, etc.
 *
 * REST base: https://api.bybit.com  (same key as Bybit Spot)
 * API docs: https://bybit-exchange.github.io/docs/v5/position
 *
 * Bybit Linear supports the full derivatives feature set:
 *  - Hedge mode (simultaneous long + short)
 *  - Isolated and cross margin per position
 *  - Conditional orders (trigger by price)
 *  - Trailing stops
 *  - Batch order submission (up to 20 per call)
 *
 * Status: STUB — all methods return ExchangeUnsupportedOperationError.
 */
export class BybitLinearAdapter extends StubExchangeAdapter {
  readonly exchangeId = ExchangeId.BYBIT_LINEAR;

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
