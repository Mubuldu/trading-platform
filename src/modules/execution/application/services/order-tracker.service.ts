import { Injectable } from '@nestjs/common';
import { Order } from '@modules/exchange/models/trading.models';
import { OrderStatus } from '@modules/exchange/enums/order.enums';
import { ExecutionRequestModel } from '../../domain/models/execution-request.model';
import { ExecutionStatus } from '../../domain/enums/execution-status.enum';

export interface OrderTrackState {
  readonly requestId: string;
  readonly clientOrderId: string;
  readonly status: ExecutionStatus;
  readonly request: ExecutionRequestModel;
  readonly order?: Order;
  readonly errorMessage?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

@Injectable()
export class OrderTrackerService {
  private readonly states = new Map<string, OrderTrackState>();

  start(requestId: string, request: ExecutionRequestModel): void {
    this.states.set(requestId, {
      requestId,
      clientOrderId: request.clientOrderId,
      status: ExecutionStatus.PENDING,
      request,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  markSubmitted(requestId: string): void {
    this.transition(requestId, ExecutionStatus.SUBMITTED);
  }

  update(requestId: string, order: Order): void {
    const existing = this.states.get(requestId);
    if (!existing) return;

    const status = this.mapOrderStatus(order);
    this.states.set(requestId, {
      ...existing,
      status,
      order,
      updatedAt: Date.now(),
    });
  }

  fail(requestId: string, errorMessage: string): void {
    const existing = this.states.get(requestId);
    if (!existing) return;
    this.states.set(requestId, {
      ...existing,
      status: ExecutionStatus.FAILED,
      errorMessage,
      updatedAt: Date.now(),
    });
  }

  get(requestId: string): OrderTrackState | undefined {
    return this.states.get(requestId);
  }

  getAll(): OrderTrackState[] {
    return [...this.states.values()];
  }

  getActive(): OrderTrackState[] {
    const terminal: ExecutionStatus[] = [
      ExecutionStatus.FILLED,
      ExecutionStatus.CANCELLED,
      ExecutionStatus.REJECTED,
      ExecutionStatus.EXPIRED,
      ExecutionStatus.FAILED,
    ];
    return [...this.states.values()].filter((s) => !terminal.includes(s.status));
  }

  private transition(requestId: string, status: ExecutionStatus): void {
    const existing = this.states.get(requestId);
    if (!existing) return;
    this.states.set(requestId, { ...existing, status, updatedAt: Date.now() });
  }

  private mapOrderStatus(order: Order): ExecutionStatus {
    switch (order.status) {
      case OrderStatus.NEW:
        return ExecutionStatus.OPEN;
      case OrderStatus.PARTIALLY_FILLED:
        return ExecutionStatus.PARTIALLY_FILLED;
      case OrderStatus.FILLED:
        return ExecutionStatus.FILLED;
      case OrderStatus.CANCELLED:
        return ExecutionStatus.CANCELLED;
      case OrderStatus.REJECTED:
        return ExecutionStatus.REJECTED;
      case OrderStatus.EXPIRED:
        return ExecutionStatus.EXPIRED;
      default:
        return ExecutionStatus.SUBMITTED;
    }
  }
}
