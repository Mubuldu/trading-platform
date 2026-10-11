import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { OrderType } from '@modules/exchange/enums/order.enums';
import { BacktestOrder } from '../../domain/models/backtest-order.model';
import { BacktestOrderStatus } from '../../domain/enums/backtest-order-status.enum';
import { OrderSubmission } from './fill-model';

@Injectable()
export class OrderQueueService {
  private readonly pending = new Map<string, BacktestOrder>();

  enqueue(submission: OrderSubmission): BacktestOrder {
    const order: BacktestOrder = {
      orderId: randomUUID(),
      strategyId: submission.strategyId,
      symbol: submission.symbol,
      side: submission.side,
      type: submission.type,
      requestedQuantity: submission.quantity,
      requestedPrice: submission.price,
      stopPrice: submission.stopPrice,
      limitPrice: submission.limitPrice,
      trailingDeltaPercent: submission.trailingDeltaPercent,
      submittedAtBarTime: submission.submittedAtBarTime,
      submittedAt: Date.now(),
      status: BacktestOrderStatus.PENDING,
      filledQuantity: 0,
      remainingQuantity: submission.quantity,
      averagePrice: 0,
      commission: 0,
    };

    this.pending.set(order.orderId, order);
    return order;
  }

  getPending(): BacktestOrder[] {
    return [...this.pending.values()].filter((o) => o.status === BacktestOrderStatus.PENDING);
  }

  getPendingForSymbol(symbol: string): BacktestOrder[] {
    return this.getPending().filter((o) => o.symbol === symbol);
  }

  getMarketOrders(): BacktestOrder[] {
    return this.getPending().filter((o) => o.type === OrderType.MARKET);
  }

  getLimitOrders(): BacktestOrder[] {
    return this.getPending().filter((o) => o.type === OrderType.LIMIT);
  }

  getStopOrders(): BacktestOrder[] {
    return this.getPending().filter((o) => o.type === OrderType.STOP);
  }

  getTrailingStopOrders(): BacktestOrder[] {
    return this.getPending().filter((o) => o.type === OrderType.TRAILING_STOP);
  }

  markFilled(
    orderId: string,
    filledQty: number,
    price: number,
    commission: number,
    fillTime: number,
  ): void {
    const order = this.pending.get(orderId);
    if (!order) return;

    const cumFilled = order.filledQuantity + filledQty;
    const avgPrice =
      order.filledQuantity === 0
        ? price
        : (order.averagePrice * order.filledQuantity + price * filledQty) / cumFilled;

    const updatedOrder = order as unknown as Record<string, unknown>;
    updatedOrder['filledQuantity'] = cumFilled;
    updatedOrder['remainingQuantity'] = order.requestedQuantity - cumFilled;
    updatedOrder['averagePrice'] = avgPrice;
    updatedOrder['commission'] = order.commission + commission;
    updatedOrder['fillTime'] = fillTime;

    if (cumFilled >= order.requestedQuantity) {
      updatedOrder['status'] = BacktestOrderStatus.FILLED;
      this.pending.delete(orderId);
    } else {
      updatedOrder['status'] = BacktestOrderStatus.PARTIALLY_FILLED;
    }
  }

  cancel(orderId: string, cancelTime: number): boolean {
    const order = this.pending.get(orderId);
    if (!order) return false;
    (order as unknown as Record<string, unknown>)['status'] = BacktestOrderStatus.CANCELLED;
    (order as unknown as Record<string, unknown>)['cancelTime'] = cancelTime;
    this.pending.delete(orderId);
    return true;
  }

  cancelAll(symbol?: string): BacktestOrder[] {
    const cancelTime = Date.now();
    const cancelled: BacktestOrder[] = [];
    for (const order of this.pending.values()) {
      if (!symbol || order.symbol === symbol) {
        (order as unknown as Record<string, unknown>)['status'] = BacktestOrderStatus.CANCELLED;
        (order as unknown as Record<string, unknown>)['cancelTime'] = cancelTime;
        cancelled.push(order);
      }
    }
    if (symbol) {
      for (const order of cancelled) this.pending.delete(order.orderId);
    } else {
      this.pending.clear();
    }
    return cancelled;
  }

  updateTrailStop(orderId: string, peakPrice: number, stopPrice: number): void {
    const order = this.pending.get(orderId);
    if (!order) return;
    (order as unknown as Record<string, unknown>)['trailPeakPrice'] = peakPrice;
    (order as unknown as Record<string, unknown>)['trailStopPrice'] = stopPrice;
  }

  getAll(): BacktestOrder[] {
    return [...this.pending.values()];
  }

  reset(): void {
    this.pending.clear();
  }

  size(): number {
    return this.pending.size;
  }
}
