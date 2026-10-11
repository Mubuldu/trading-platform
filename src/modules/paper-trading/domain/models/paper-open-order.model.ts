import { NormalizedSymbol } from '@modules/exchange/models/common.model';
import { OrderSide, OrderType, TimeInForce } from '@modules/exchange/enums/order.enums';
import { PaperOrderState } from '../enums/paper-order-state.enum';

/**
 * PaperOpenOrder represents a pending limit or stop order in the paper engine.
 *
 * Market orders are filled synchronously and never held in the open-order book.
 * Limit, stop, and trailing-stop orders sit here until price triggers them or
 * the order is cancelled.
 *
 * trailPeakPrice / trailStopPrice are only set for TRAILING_STOP orders and
 * are updated on every incoming tick.
 */
export interface PaperOpenOrder {
  readonly orderId: string;
  readonly clientOrderId: string;
  readonly requestId: string;
  readonly decisionId: string;
  readonly strategyId: string;
  readonly symbol: NormalizedSymbol;
  readonly side: OrderSide;
  readonly type: OrderType;
  readonly timeInForce: TimeInForce;
  readonly requestedQuantity: number;
  filledQuantity: number;
  remainingQuantity: number;
  readonly limitPrice?: number;
  readonly stopPrice?: number;
  readonly trailingDeltaBps?: number;
  trailPeakPrice?: number;
  trailStopPrice?: number;
  readonly reduceOnly: boolean;
  readonly postOnly: boolean;
  state: PaperOrderState;
  readonly createdAt: number;
  updatedAt: number;
}
