import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { ExchangeFactory } from '@modules/exchange/factories/exchange.factory';
import { OrderManagerService } from '@modules/order/application/services/order-manager.service';
import { OrderModel } from '@modules/order/domain/models/order.model';
import { Order } from '@modules/exchange/models/trading.models';
import { OrderStatus } from '@modules/exchange/enums/order.enums';
import { OrderMismatchType } from '../../domain/enums/mismatch-type.enum';
import { RecoveryAction } from '../../domain/enums/recovery-action.enum';
import {
  OrderMismatch,
  InternalOrderSnapshot,
  ExchangeOrderSnapshot,
} from '../../domain/models/order-mismatch.model';

@Injectable()
export class OrderReconcilerService {
  private readonly context = OrderReconcilerService.name;

  constructor(
    private readonly logger: AppLoggerService,
    private readonly exchangeFactory: ExchangeFactory,
    private readonly orderManager: OrderManagerService,
  ) {}

  async reconcile(): Promise<OrderMismatch[]> {
    const [internalOrders, exchangeOrders] = await Promise.all([
      this.fetchInternal(),
      this.fetchExchange(),
    ]);

    if (exchangeOrders === null) {
      this.logger.warn(
        'Order reconciliation skipped — no exchange adapter available',
        this.context,
      );
      return [];
    }

    return this.compare(internalOrders, exchangeOrders);
  }

  private async fetchInternal(): Promise<OrderModel[]> {
    try {
      return await this.orderManager.getActiveOrders();
    } catch (e) {
      this.logger.error(
        `Failed to fetch internal orders: ${(e as Error).message}`,
        undefined,
        this.context,
      );
      return [];
    }
  }

  private async fetchExchange(): Promise<Order[] | null> {
    const adapters = this.exchangeFactory.getActiveAdapters();
    if (adapters.length === 0) return null;

    const all: Order[] = [];
    for (const adapter of adapters) {
      try {
        const result = await adapter.getOpenOrders();
        if (result.isOk()) {
          all.push(...result.value);
        } else {
          this.logger.warn(
            `Exchange ${adapter.exchangeId} returned error for getOpenOrders: ${result.error.message}`,
            this.context,
          );
        }
      } catch (e) {
        this.logger.error(
          `Failed to fetch open orders from ${adapter.exchangeId}: ${(e as Error).message}`,
          undefined,
          this.context,
        );
      }
    }
    return all;
  }

  private compare(internal: OrderModel[], exchange: Order[]): OrderMismatch[] {
    const mismatches: OrderMismatch[] = [];
    const now = Date.now();

    const internalByClientId = new Map(
      internal.filter((o) => o.clientOrderId).map((o) => [o.clientOrderId, o]),
    );
    const internalByExchangeId = new Map(
      internal.filter((o) => o.exchangeOrderId).map((o) => [o.exchangeOrderId!, o]),
    );

    const exchangeByExchangeId = new Map(exchange.map((o) => [o.exchangeOrderId, o]));
    const exchangeByClientId = new Map(
      exchange.filter((o) => o.clientOrderId).map((o) => [o.clientOrderId!, o]),
    );

    // Detect ghost orders (on exchange but not in internal state)
    for (const [exchangeOrderId, exchangeOrder] of exchangeByExchangeId) {
      const hasInternal =
        internalByExchangeId.has(exchangeOrderId) ||
        (exchangeOrder.clientOrderId && internalByClientId.has(exchangeOrder.clientOrderId));

      if (!hasInternal && this.isActiveStatus(exchangeOrder.status)) {
        mismatches.push({
          clientOrderId: exchangeOrder.clientOrderId,
          exchangeOrderId,
          symbol: exchangeOrder.symbol,
          type: OrderMismatchType.GHOST_ORDER,
          internal: null,
          exchange: this.toExchangeSnapshot(exchangeOrder),
          recoveryAction: RecoveryAction.MANUAL_REQUIRED,
          detectedAt: now,
        });
      }
    }

    // Detect missing orders (internal tracks as open but not on exchange)
    for (const [clientOrderId, internalOrder] of internalByClientId) {
      const exchangeOrder =
        (internalOrder.exchangeOrderId &&
          exchangeByExchangeId.get(internalOrder.exchangeOrderId)) ||
        exchangeByClientId.get(clientOrderId);

      if (!exchangeOrder) {
        mismatches.push({
          clientOrderId,
          exchangeOrderId: internalOrder.exchangeOrderId,
          symbol: internalOrder.symbol,
          type: OrderMismatchType.MISSING_ORDER,
          internal: this.toInternalSnapshot(internalOrder),
          exchange: null,
          recoveryAction: RecoveryAction.SYNC_FROM_EXCHANGE,
          detectedAt: now,
        });
        continue;
      }

      // Status mismatch check
      const exchangeIsClosed = !this.isActiveStatus(exchangeOrder.status);
      if (exchangeIsClosed) {
        mismatches.push({
          clientOrderId,
          exchangeOrderId: internalOrder.exchangeOrderId,
          symbol: internalOrder.symbol,
          type: OrderMismatchType.STATUS_MISMATCH,
          internal: this.toInternalSnapshot(internalOrder),
          exchange: this.toExchangeSnapshot(exchangeOrder),
          recoveryAction: RecoveryAction.SYNC_FROM_EXCHANGE,
          detectedAt: now,
        });
      }

      // Quantity mismatch check
      const qtyDiff = Math.abs(internalOrder.executedQuantity - exchangeOrder.executedQuantity);
      if (qtyDiff > 0.000001 && exchangeOrder.executedQuantity > internalOrder.executedQuantity) {
        mismatches.push({
          clientOrderId,
          exchangeOrderId: internalOrder.exchangeOrderId,
          symbol: internalOrder.symbol,
          type: OrderMismatchType.QUANTITY_MISMATCH,
          internal: this.toInternalSnapshot(internalOrder),
          exchange: this.toExchangeSnapshot(exchangeOrder),
          recoveryAction: RecoveryAction.SYNC_FROM_EXCHANGE,
          detectedAt: now,
        });
      }
    }

    // Detect duplicates (multiple internal entries for same exchangeOrderId)
    const exchangeIdCounts = new Map<string, number>();
    for (const order of internal) {
      if (order.exchangeOrderId) {
        exchangeIdCounts.set(
          order.exchangeOrderId,
          (exchangeIdCounts.get(order.exchangeOrderId) ?? 0) + 1,
        );
      }
    }
    for (const [exchangeOrderId, count] of exchangeIdCounts) {
      if (count > 1) {
        const internalOrder = internalByExchangeId.get(exchangeOrderId);
        mismatches.push({
          clientOrderId: internalOrder?.clientOrderId,
          exchangeOrderId,
          symbol: internalOrder?.symbol ?? 'unknown',
          type: OrderMismatchType.DUPLICATE_ORDER,
          internal: internalOrder ? this.toInternalSnapshot(internalOrder) : null,
          exchange: null,
          recoveryAction: RecoveryAction.MANUAL_REQUIRED,
          detectedAt: now,
        });
      }
    }

    return mismatches;
  }

  private isActiveStatus(status: OrderStatus): boolean {
    return status === OrderStatus.NEW || status === OrderStatus.PARTIALLY_FILLED;
  }

  private toInternalSnapshot(o: OrderModel): InternalOrderSnapshot {
    return {
      clientOrderId: o.clientOrderId,
      exchangeOrderId: o.exchangeOrderId,
      symbol: o.symbol,
      side: o.side,
      state: o.state,
      requestedQuantity: o.requestedQuantity,
      executedQuantity: o.executedQuantity,
    };
  }

  private toExchangeSnapshot(o: Order): ExchangeOrderSnapshot {
    return {
      exchangeOrderId: o.exchangeOrderId,
      clientOrderId: o.clientOrderId,
      symbol: o.symbol,
      side: o.side,
      status: o.status,
      originalQuantity: o.originalQuantity,
      executedQuantity: o.executedQuantity,
    };
  }
}
