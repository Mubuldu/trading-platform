import { ExchangeModelBase, NormalizedSymbol } from './common.model';
import { OrderSide, OrderStatus, OrderType, TimeInForce } from '../enums/order.enums';
import { PositionSide } from '../enums/position.enums';
import { ExchangeId } from '../enums/exchange.enums';

/**
 * Order is the normalized representation of an exchange order.
 *
 * exchangeOrderId is the exchange's own identifier. clientOrderId is
 * the identifier we send in the request (optional, used for idempotency).
 *
 * fees: we normalize fee information into a single asset+amount pair.
 * Some exchanges report fees in multiple assets — adapters must aggregate
 * into the quote asset equivalent.
 */
export interface Order extends ExchangeModelBase {
  readonly exchangeOrderId: string;
  readonly clientOrderId?: string;
  readonly updatedAt: Date;

  readonly side: OrderSide;
  readonly type: OrderType;
  readonly status: OrderStatus;
  readonly timeInForce: TimeInForce;
  readonly positionSide?: PositionSide;

  readonly originalQuantity: number;
  readonly executedQuantity: number;
  readonly remainingQuantity: number;
  readonly cumulativeQuoteQuantity: number;

  readonly price: number;
  readonly averagePrice: number;
  readonly stopPrice?: number;
  readonly trailingDelta?: number;

  readonly reduceOnly?: boolean;
  readonly postOnly?: boolean;
  readonly isIceberg?: boolean;
  readonly icebergQuantity?: number;

  readonly feeAmount?: number;
  readonly feeAsset?: string;
}

/**
 * ExecutionReport is published when an order changes state (partially filled,
 * filled, cancelled, etc.). It carries the incremental fill information for
 * that single state change.
 *
 * Used by: execution engine to track fill progress, position manager to
 * update open positions, P&L tracker.
 */
export interface ExecutionReport extends ExchangeModelBase {
  readonly exchangeOrderId: string;
  readonly exchangeTradeId?: string;
  readonly clientOrderId?: string;

  readonly side: OrderSide;
  readonly type: OrderType;
  readonly previousStatus: OrderStatus;
  readonly currentStatus: OrderStatus;
  readonly positionSide?: PositionSide;

  readonly lastExecutedQuantity: number;
  readonly lastExecutedPrice: number;
  readonly cumulativeFilledQuantity: number;
  readonly cumulativeQuoteQuantity: number;

  readonly commissionAmount?: number;
  readonly commissionAsset?: string;

  readonly isMaker?: boolean;
  readonly isLiquidation?: boolean;
  readonly isReduceOnly?: boolean;

  readonly workingTime: Date;
}

/**
 * SubmitOrderRequest is the normalized input for placing an order.
 *
 * The adapter translates this into the exchange-specific request format.
 * No exchange-specific fields exist here.
 *
 * clientOrderId: a unique reference we generate. Used for idempotency and
 * order tracking. If not provided, the adapter generates one.
 */
export interface SubmitOrderRequest {
  readonly symbol: NormalizedSymbol;
  readonly side: OrderSide;
  readonly type: OrderType;
  readonly quantity: number;
  readonly price?: number;
  readonly stopPrice?: number;
  readonly timeInForce?: TimeInForce;
  readonly clientOrderId?: string;
  readonly reduceOnly?: boolean;
  readonly postOnly?: boolean;
  readonly positionSide?: PositionSide;
  readonly tpPrice?: number;
  readonly slPrice?: number;
  readonly trailingDelta?: number;
  readonly icebergQuantity?: number;
  readonly correlationId?: string;
}

export interface CancelOrderRequest {
  readonly symbol: NormalizedSymbol;
  readonly exchangeOrderId?: string;
  readonly clientOrderId?: string;
  readonly correlationId?: string;
}

export interface ModifyOrderRequest {
  readonly symbol: NormalizedSymbol;
  readonly exchangeOrderId?: string;
  readonly clientOrderId?: string;
  readonly price?: number;
  readonly quantity?: number;
  readonly correlationId?: string;
}

export interface BatchOrderResult {
  readonly exchangeId: ExchangeId;
  readonly orders: Order[];
  readonly errors: Array<{ request: SubmitOrderRequest; error: Error }>;
  readonly timestamp: Date;
}
