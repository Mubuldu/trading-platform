import { Result } from '@common/result';
import { Order } from '../models/trading.models';
import { NormalizedSymbol } from '../models/common.model';
import { OrderStatus } from '../enums/order.enums';
import { ExchangeError } from '../errors/exchange.error';

export interface OrderHistoryQuery {
  readonly symbol?: NormalizedSymbol;
  readonly status?: OrderStatus;
  readonly startTime?: Date;
  readonly endTime?: Date;
  readonly limit?: number;
  readonly pageToken?: string;
}

/**
 * OrderProvider retrieves order state from the exchange.
 *
 * This is READ-ONLY. For order submission, use TradingProvider.
 *
 * openOrders: real-time list of orders in NEW or PARTIALLY_FILLED status.
 * closedOrders: completed orders (FILLED, CANCELLED, REJECTED, EXPIRED).
 * orderHistory: full historical view with pagination.
 *
 * Adapters should cache open orders and update the cache on each execution
 * report to minimize REST polling against rate limits.
 */
export interface OrderProvider {
  getOpenOrders(symbol?: NormalizedSymbol): Promise<Result<Order[], ExchangeError>>;
  getClosedOrders(
    symbol?: NormalizedSymbol,
    limit?: number,
  ): Promise<Result<Order[], ExchangeError>>;
  getOrderHistory(query: OrderHistoryQuery): Promise<Result<Order[], ExchangeError>>;
  getOrder(
    exchangeOrderId: string,
    symbol: NormalizedSymbol,
  ): Promise<Result<Order, ExchangeError>>;
  getOrderByClientId(
    clientOrderId: string,
    symbol: NormalizedSymbol,
  ): Promise<Result<Order, ExchangeError>>;
}
