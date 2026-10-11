import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { OrderSide, OrderType, TimeInForce } from '@modules/exchange/enums/order.enums';

export interface ExecutionRequestModel {
  readonly requestId: string;
  readonly decisionId: string;
  readonly strategyId: string;
  readonly signalId: string;
  readonly exchangeId: ExchangeId;
  readonly symbol: string;
  readonly side: OrderSide;
  readonly orderType: OrderType;
  readonly quantity: number;
  readonly price?: number;
  readonly stopPrice?: number;
  readonly timeInForce?: TimeInForce;
  readonly reduceOnly?: boolean;
  readonly postOnly?: boolean;
  readonly clientOrderId: string;
  readonly correlationId: string;
  readonly createdAt: number;
}
