import { ILogger } from '@core/logging/logger.interface';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { ExchangeCapabilities } from '@modules/exchange/models/exchange.models';
import { SymbolNormalizer } from '@modules/exchange/normalizers/symbol.normalizer';
import { OrderStatusNormalizer } from '@modules/exchange/normalizers/order-status.normalizer';
import { OrderValidator } from '@modules/exchange/validators/order.validator';
import { StubExchangeAdapter } from '@modules/exchange/adapters/stub-exchange.adapter';

/**
 * BybitInverseAdapter — Bybit COIN-margined (inverse) perpetuals and futures (category=inverse).
 *
 * "Inverse" = base-asset-margined contracts. P&L and collateral are in the
 * base asset (BTC for BTCUSD). No USDT required.
 * Symbols: BTCUSD, ETHUSD, etc.
 *
 * REST base: https://api.bybit.com  (same key as Bybit Spot)
 * API docs: https://bybit-exchange.github.io/docs/v5/position
 *
 * Status: STUB — all methods return ExchangeUnsupportedOperationError.
 */
export class BybitInverseAdapter extends StubExchangeAdapter {
  readonly exchangeId = ExchangeId.BYBIT_INVERSE;

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
