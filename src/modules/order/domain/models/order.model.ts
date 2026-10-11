import { OrderSide, OrderType } from '@modules/exchange/enums/order.enums';
import { OrderState } from '../enums/order-state.enum';

export interface OrderModel {
  // Immutable identity
  readonly orderId: string;
  readonly clientOrderId: string;
  readonly correlationId: string;
  readonly executionRequestId: string;
  readonly riskDecisionId: string;
  readonly strategyId: string;
  readonly exchangeId: string;
  readonly accountId: string;
  readonly symbol: string;
  readonly side: OrderSide;
  readonly orderType: OrderType;

  // Mutable — assigned by exchange on acknowledgement
  exchangeOrderId?: string;

  // State machine
  state: OrderState;

  // Quantity tracking
  requestedQuantity: number;
  executedQuantity: number;
  remainingQuantity: number;
  averagePrice: number;

  // Execution attempts (for retries)
  executionAttempts: number;

  // Dedup + audit trail
  reportIds: string[];

  // Timestamps (all epoch-ms)
  createdAt: number;
  updatedAt: number;
  submittedAt?: number;
  acknowledgedAt?: number;
  firstFillAt?: number;
  filledAt?: number;
  closedAt?: number;

  // Error info
  errorMessage?: string;

  // Optimistic locking
  version: number;
}

export function createNewOrder(params: {
  clientOrderId: string;
  correlationId: string;
  executionRequestId: string;
  riskDecisionId: string;
  strategyId: string;
  exchangeId: string;
  accountId: string;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  requestedQuantity: number;
}): OrderModel {
  const now = Date.now();
  return {
    orderId: params.clientOrderId,
    clientOrderId: params.clientOrderId,
    correlationId: params.correlationId,
    executionRequestId: params.executionRequestId,
    riskDecisionId: params.riskDecisionId,
    strategyId: params.strategyId,
    exchangeId: params.exchangeId,
    accountId: params.accountId,
    symbol: params.symbol,
    side: params.side,
    orderType: params.orderType,
    state: OrderState.NEW,
    requestedQuantity: params.requestedQuantity,
    executedQuantity: 0,
    remainingQuantity: params.requestedQuantity,
    averagePrice: 0,
    executionAttempts: 0,
    reportIds: [],
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}
