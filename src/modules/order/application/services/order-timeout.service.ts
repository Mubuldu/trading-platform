import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { StreamPublisherService } from '@infrastructure/redis/streams/stream-publisher.service';
import { STREAM_NAMES } from '@infrastructure/redis/streams/stream-names.constants';
import { OrderModel } from '../../domain/models/order.model';
import { OrderState } from '../../domain/enums/order-state.enum';
import { OrderCacheService } from './order-cache.service';
import { OrderMetricsService } from './order-metrics.service';

export interface TimeoutConfig {
  pendingTimeoutMs: number;
  ackTimeoutMs: number;
  fillTimeoutMs: number;
}

@Injectable()
export class OrderTimeoutService {
  private readonly context = OrderTimeoutService.name;

  constructor(
    private readonly logger: AppLoggerService,
    private readonly cache: OrderCacheService,
    private readonly metrics: OrderMetricsService,
    private readonly publisher: StreamPublisherService,
  ) {}

  async checkAll(cfg: TimeoutConfig): Promise<void> {
    const orders = await this.cache.loadAll();
    const now = Date.now();

    for (const order of orders) {
      const timedOut = this.detectTimeout(order, now, cfg);
      if (timedOut) {
        await this.expireOrder(order, timedOut);
      }
    }
  }

  private detectTimeout(order: OrderModel, now: number, cfg: TimeoutConfig): string | null {
    switch (order.state) {
      case OrderState.SUBMITTED:
        if (order.submittedAt && now - order.submittedAt > cfg.ackTimeoutMs) {
          return 'acknowledgement timeout';
        }
        break;

      case OrderState.ACKNOWLEDGED:
      case OrderState.OPEN:
        if (order.acknowledgedAt && now - order.acknowledgedAt > cfg.fillTimeoutMs) {
          return 'fill timeout';
        }
        break;

      case OrderState.NEW:
      case OrderState.VALIDATED:
        if (now - order.createdAt > cfg.pendingTimeoutMs) {
          return 'pending timeout';
        }
        break;

      case OrderState.PARTIALLY_FILLED:
        if (order.firstFillAt && now - order.firstFillAt > cfg.fillTimeoutMs) {
          return 'fill timeout';
        }
        break;
    }

    return null;
  }

  private async expireOrder(order: OrderModel, reason: string): Promise<void> {
    order.state = OrderState.EXPIRED;
    order.closedAt = Date.now();
    order.updatedAt = order.closedAt;
    order.errorMessage = reason;
    order.version++;

    await this.cache.remove(order.clientOrderId);
    this.metrics.recordExpired();

    this.logger.warn(
      `Order expired [${reason}]: clientOrderId=${order.clientOrderId} symbol=${order.symbol} state-before=${order.state}`,
      this.context,
    );

    try {
      await this.publisher.publish(STREAM_NAMES.ORDER_UPDATE, {
        correlationId: order.correlationId,
        eventType: 'OrderExpired',
        exchange: order.exchangeId,
        symbol: order.symbol,
        timestamp: order.updatedAt,
        producer: this.context,
        payload: this.toPayload(order),
      });
    } catch (e) {
      this.logger.error(
        `Failed to publish order expiry: ${(e as Error).message}`,
        undefined,
        this.context,
      );
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toPayload(order: OrderModel): Record<string, any> {
    return {
      orderId: order.orderId,
      clientOrderId: order.clientOrderId,
      exchangeOrderId: order.exchangeOrderId,
      symbol: order.symbol,
      side: order.side,
      state: order.state,
      executedQuantity: order.executedQuantity,
      remainingQuantity: order.remainingQuantity,
      averagePrice: order.averagePrice,
      closedAt: order.closedAt,
      errorMessage: order.errorMessage,
    };
  }
}
