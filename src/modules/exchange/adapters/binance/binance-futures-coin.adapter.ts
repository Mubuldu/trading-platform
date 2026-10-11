import { ILogger } from '@core/logging/logger.interface';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { ExchangeCapabilities } from '@modules/exchange/models/exchange.models';
import { SymbolNormalizer } from '@modules/exchange/normalizers/symbol.normalizer';
import { OrderStatusNormalizer } from '@modules/exchange/normalizers/order-status.normalizer';
import { OrderValidator } from '@modules/exchange/validators/order.validator';
import { StubExchangeAdapter } from '@modules/exchange/adapters/stub-exchange.adapter';

/**
 * BinanceFuturesCoinAdapter — Binance COIN-margined (inverse) perpetual & delivery futures.
 *
 * Endpoint family: /dapi/v1/*
 * API docs: https://binance-docs.github.io/apidocs/delivery/en/
 *
 * COIN-margined contracts are settled in the base asset (BTC for BTCUSD).
 * Positions and P&L are denominated in BTC, not USDT.
 *
 * Status: STUB — see BinanceFuturesUsdtAdapter for implementation checklist.
 */
export class BinanceFuturesCoinAdapter extends StubExchangeAdapter {
  readonly exchangeId = ExchangeId.BINANCE_FUTURES_COIN;

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
