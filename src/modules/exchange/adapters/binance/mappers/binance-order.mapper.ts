import { Injectable } from '@nestjs/common';
import { Result, ok, err } from '@common/result';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import {
  OrderStatus,
  OrderSide,
  OrderType,
  TimeInForce,
} from '@modules/exchange/enums/order.enums';
import { NormalizedSymbol } from '@modules/exchange/models/common.model';
import { Order } from '@modules/exchange/models/trading.models';
import {
  ExchangeError,
  ExchangeInvalidRequestError,
} from '@modules/exchange/errors/exchange.error';
import { OrderStatusNormalizer } from '@modules/exchange/normalizers/order-status.normalizer';
import { BinanceRawOrder } from '../client/binance-http.types';

const EX = ExchangeId.BINANCE_SPOT;

/**
 * BinanceOrderMapper normalizes raw Binance order objects into our Order model.
 *
 * Key normalizations:
 *  - averagePrice: computed from cummulativeQuoteQty / executedQty
 *    (Binance does not return averagePrice directly on orders, only on fills)
 *  - remainingQuantity: origQty - executedQty
 *  - OrderStatus: delegated to OrderStatusNormalizer (handles Binance's
 *    "CANCELED" (single L) spelling variant)
 *  - OrderSide/OrderType/TimeInForce: direct string→enum mapping
 *  - timestamp: Binance 'time' field (creation time, unix ms)
 *  - updatedAt: Binance 'updateTime' field (last state change, unix ms)
 */
@Injectable()
export class BinanceOrderMapper {
  constructor(private readonly statusNormalizer: OrderStatusNormalizer) {}

  map(raw: BinanceRawOrder, receivedAt: Date): Result<Order, ExchangeError> {
    try {
      const symbol = NormalizedSymbol.unsafe(this.inferNormalizedSymbol(raw.symbol));
      const executedQty = parseFloat(raw.executedQty);
      const origQty = parseFloat(raw.origQty);
      const cumulativeQuoteQty = parseFloat(raw.cummulativeQuoteQty);

      const averagePrice = executedQty > 0 ? cumulativeQuoteQty / executedQty : 0;

      const price = parseFloat(raw.price);
      const stopPrice =
        raw.stopPrice && raw.stopPrice !== '0.00000000' ? parseFloat(raw.stopPrice) : undefined;

      const timestamp = new Date(raw.time);
      const updatedAt = new Date(raw.updateTime);

      return ok({
        exchangeId: EX,
        symbol,
        timestamp,
        receivedAt,

        exchangeOrderId: String(raw.orderId),
        clientOrderId: raw.clientOrderId || undefined,
        updatedAt,

        side: this.mapSide(raw.side),
        type: this.mapOrderType(raw.type),
        status: this.statusNormalizer.normalize(raw.status, EX),
        timeInForce: this.mapTimeInForce(raw.timeInForce),

        originalQuantity: origQty,
        executedQuantity: executedQty,
        remainingQuantity: Math.max(0, origQty - executedQty),
        cumulativeQuoteQuantity: cumulativeQuoteQty,

        price,
        averagePrice,
        stopPrice,

        reduceOnly: false,
        postOnly: raw.type === 'LIMIT_MAKER',
        isIceberg: raw.icebergQty ? parseFloat(raw.icebergQty) > 0 : false,
        icebergQuantity:
          raw.icebergQty && parseFloat(raw.icebergQty) > 0 ? parseFloat(raw.icebergQty) : undefined,

        feeAmount: undefined,
        feeAsset: undefined,
      });
    } catch (e) {
      return err(
        new ExchangeInvalidRequestError(EX, `Failed to parse order ${raw.orderId}: ${String(e)}`, {
          orderId: raw.orderId,
        }),
      );
    }
  }

  mapMany(rawOrders: BinanceRawOrder[], receivedAt: Date): Result<Order[], ExchangeError> {
    const orders: Order[] = [];
    for (const raw of rawOrders) {
      const result = this.map(raw, receivedAt);
      if (result.isErr()) return err(result.error);
      orders.push(result.value);
    }
    return ok(orders);
  }

  private mapSide(side: string): OrderSide {
    return side === 'BUY' ? OrderSide.BUY : OrderSide.SELL;
  }

  private mapOrderType(type: string): OrderType {
    const map: Record<string, OrderType> = {
      MARKET: OrderType.MARKET,
      LIMIT: OrderType.LIMIT,
      LIMIT_MAKER: OrderType.LIMIT,
      STOP_LOSS: OrderType.STOP,
      STOP_LOSS_LIMIT: OrderType.STOP_LIMIT,
      TAKE_PROFIT: OrderType.TAKE_PROFIT,
      TAKE_PROFIT_LIMIT: OrderType.TAKE_PROFIT_LIMIT,
    };
    return map[type] ?? OrderType.LIMIT;
  }

  private mapTimeInForce(tif: string): TimeInForce {
    const map: Record<string, TimeInForce> = {
      GTC: TimeInForce.GTC,
      IOC: TimeInForce.IOC,
      FOK: TimeInForce.FOK,
    };
    return map[tif] ?? TimeInForce.GTC;
  }

  /**
   * Converts Binance's concatenated symbol ("BTCUSDT") to a normalized
   * symbol using a best-effort parse. The SymbolNormalizer should be used
   * for production code — this is only a fallback in the mapper.
   *
   * The correct approach is to look up the symbol from the ExchangeInfo
   * cache (done by the adapter, not this mapper).
   */
  private inferNormalizedSymbol(binanceSymbol: string): string {
    // Return as-is; the adapter resolves to NormalizedSymbol via normalizer.
    // The mapper calls NormalizedSymbol.unsafe() to satisfy the type system.
    return binanceSymbol;
  }
}

/**
 * Maps Binance order status strings to OrderStatus enum values.
 * Registered with OrderStatusNormalizer so this file only defines the data.
 */
export const BINANCE_ORDER_STATUS_MAP: Record<string, OrderStatus> = {
  NEW: OrderStatus.NEW,
  PARTIALLY_FILLED: OrderStatus.PARTIALLY_FILLED,
  FILLED: OrderStatus.FILLED,
  CANCELED: OrderStatus.CANCELLED,
  PENDING_CANCEL: OrderStatus.PENDING_CANCEL,
  REJECTED: OrderStatus.REJECTED,
  EXPIRED: OrderStatus.EXPIRED,
  EXPIRED_IN_MATCH: OrderStatus.EXPIRED,
};
