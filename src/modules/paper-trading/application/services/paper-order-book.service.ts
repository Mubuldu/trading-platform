import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { StreamPublisherService } from '@infrastructure/redis/streams/stream-publisher.service';
import { STREAM_NAMES } from '@infrastructure/redis/streams/stream-names.constants';
import { MarketDataEventBus } from '@modules/exchange/market-data-event-bus';
import { MARKET_DATA_EVENTS } from '@modules/exchange/models/common.model';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { OrderType, TimeInForce, OrderStatus } from '@modules/exchange/enums/order.enums';
import { Ticker } from '@modules/exchange/models/market.models';
import { ExecutionReportType } from '@modules/execution/domain/enums/execution-report-type.enum';
import { ExecutionStatus } from '@modules/execution/domain/enums/execution-status.enum';
import { PaperOpenOrder } from '../../domain/models/paper-open-order.model';
import { PaperOrderState } from '../../domain/enums/paper-order-state.enum';
import { PaperStateStoreService } from '../../infrastructure/store/paper-state-store.service';
import { PaperFillEngineService, CurrentPrice } from './paper-fill-engine.service';
import { PaperAccountService } from './paper-account.service';

/**
 * PaperOrderBookService manages all pending paper orders and drives async fills.
 *
 * Responsibilities:
 *  1. Accept new limit / stop / trailing-stop orders (from PaperExchangeAdapter)
 *  2. Subscribe to live ticker events from MarketDataEventBus
 *  3. On each tick: check all pending orders for that symbol and execute fills
 *  4. Publish filled execution reports to EXECUTION_REPORT stream so the
 *     PaperPositionManagerService picks them up (same stream as live, filtered
 *     by exchangeId=paper_trading)
 *  5. Restore open orders from Redis on startup for crash recovery
 *
 * Market orders are NOT held here — they are filled synchronously inside
 * PaperExchangeAdapter.submitOrder() before returning.
 */
@Injectable()
export class PaperOrderBookService implements OnModuleDestroy {
  private readonly context = PaperOrderBookService.name;

  /** In-memory pending orders, keyed by orderId. */
  private readonly openOrders = new Map<string, PaperOpenOrder>();

  /** Ticker handler reference — kept so we can remove it on destroy. */
  private readonly tickerHandler: (ticker: Ticker) => void;

  constructor(
    private readonly logger: AppLoggerService,
    private readonly marketDataBus: MarketDataEventBus,
    private readonly publisher: StreamPublisherService,
    private readonly store: PaperStateStoreService,
    private readonly fillEngine: PaperFillEngineService,
    private readonly account: PaperAccountService,
  ) {
    // Bind once so we can remove the exact same reference in onModuleDestroy
    this.tickerHandler = (ticker: Ticker): void => void this.onTick(ticker);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    const saved = await this.store.loadAllOpenOrders();
    for (const order of saved) {
      this.openOrders.set(order.orderId, order);
    }

    this.marketDataBus.on(MARKET_DATA_EVENTS.TICKER_UPDATED, this.tickerHandler);

    this.logger.log(
      `Paper order book initialized — restored ${saved.length} open orders`,
      this.context,
    );
  }

  onModuleDestroy(): void {
    this.marketDataBus.off(MARKET_DATA_EVENTS.TICKER_UPDATED, this.tickerHandler);
  }

  // ── Order management ─────────────────────────────────────────────────────────

  /** Register a new pending order. Called by PaperExchangeAdapter for limit/stop orders. */
  async addOrder(order: PaperOpenOrder): Promise<void> {
    this.openOrders.set(order.orderId, order);
    await this.store.saveOpenOrder(order);
  }

  /** Cancel a pending order by ID. Returns true if found and cancelled. */
  async cancelOrder(orderId: string): Promise<PaperOpenOrder | null> {
    const order = this.openOrders.get(orderId);
    if (!order) return null;

    const cancelled: PaperOpenOrder = {
      ...order,
      state: PaperOrderState.CANCELLED,
      updatedAt: Date.now(),
    };

    this.openOrders.delete(orderId);
    await this.store.removeOpenOrder(orderId);

    // Release locked balance for buy orders
    if (order.limitPrice) {
      const locked = order.remainingQuantity * order.limitPrice;
      this.account.releaseLockedBalance(locked);
    }

    this.logger.debug(`Paper order cancelled: ${orderId}`, this.context);
    return cancelled;
  }

  /** Cancel all pending orders, optionally filtered by symbol. */
  async cancelAll(symbol?: string): Promise<PaperOpenOrder[]> {
    const cancelled: PaperOpenOrder[] = [];
    const toCancel = symbol
      ? [...this.openOrders.values()].filter((o) => o.symbol === symbol)
      : [...this.openOrders.values()];

    for (const order of toCancel) {
      const result = await this.cancelOrder(order.orderId);
      if (result) cancelled.push(result);
    }
    return cancelled;
  }

  /** Expire GTC orders that should be closed at session end. */
  async expireGtcOrders(): Promise<void> {
    const gooExpire = [...this.openOrders.values()].filter(
      (o) => o.timeInForce !== TimeInForce.GTC,
    );
    for (const order of gooExpire) {
      const expired: PaperOpenOrder = {
        ...order,
        state: PaperOrderState.EXPIRED,
        updatedAt: Date.now(),
      };
      this.openOrders.delete(order.orderId);
      await this.store.removeOpenOrder(order.orderId);
      await this.publishExpiredReport(expired);
    }
  }

  getOpenOrders(symbol?: string): PaperOpenOrder[] {
    const all = [...this.openOrders.values()];
    return symbol ? all.filter((o) => o.symbol === symbol) : all;
  }

  getOrder(orderId: string): PaperOpenOrder | undefined {
    return this.openOrders.get(orderId);
  }

  // ── Tick processing ──────────────────────────────────────────────────────────

  private async onTick(ticker: Ticker): Promise<void> {
    const symbol = ticker.symbol;
    const pending = [...this.openOrders.values()].filter((o) => o.symbol === symbol);
    if (pending.length === 0) return;

    const price: CurrentPrice = {
      symbol,
      bestBid: ticker.bestBid,
      bestAsk: ticker.bestAsk,
      midPrice: ticker.midPrice,
      lastPrice: ticker.lastPrice,
    };

    for (const order of pending) {
      await this.tryProcessOrder(order, price);
    }
  }

  private async tryProcessOrder(order: PaperOpenOrder, price: CurrentPrice): Promise<void> {
    let result = null;

    switch (order.type) {
      case OrderType.LIMIT:
        result = this.fillEngine.tryFillLimitOrder(order, price, order.decisionId, order.requestId);
        break;
      case OrderType.STOP:
      case OrderType.STOP_LIMIT:
        result = this.fillEngine.tryFillStopOrder(order, price, order.decisionId, order.requestId);
        break;
      case OrderType.TRAILING_STOP:
        result = this.fillEngine.tryFillTrailingStopOrder(
          order,
          price,
          order.decisionId,
          order.requestId,
        );
        // Always save trail state even when not triggered (trail prices updated)
        await this.store.saveOpenOrder(order);
        break;
      default:
        return;
    }

    if (!result) return;

    const { fill, updatedOrder } = result;

    // Update order state
    if (
      updatedOrder.state === PaperOrderState.FILLED ||
      updatedOrder.state === PaperOrderState.CANCELLED
    ) {
      this.openOrders.delete(order.orderId);
      await this.store.removeOpenOrder(order.orderId);
    } else {
      this.openOrders.set(order.orderId, updatedOrder);
      await this.store.saveOpenOrder(updatedOrder);
    }

    // Record fill
    await this.store.appendFill(fill);

    // Apply fill to account
    const isBuy = fill.side === 'BUY';
    this.account.applyFill({
      isBuy,
      quoteAmount: fill.notional,
      commission: fill.commission,
      realizedPnl: 0, // position manager calculates this
      fromLocked: isBuy && !!order.limitPrice,
    });

    // Publish execution report to EXECUTION_REPORT stream (discriminated by exchangeId)
    await this.publishFillReport(
      updatedOrder,
      fill.fillId,
      fill.filledQuantity,
      fill.fillPrice,
      fill.commission,
    );

    this.logger.log(
      `[PAPER-ASYNC-FILL] ${fill.side} ${fill.filledQuantity} ${fill.symbol}@${fill.fillPrice} ` +
        `order=${order.orderId} type=${order.type}`,
      this.context,
    );
  }

  // ── Publishing ───────────────────────────────────────────────────────────────

  private async publishFillReport(
    order: PaperOpenOrder,
    reportId: string,
    executedQty: number,
    avgPrice: number,
    commission: number,
  ): Promise<void> {
    const isPartial = order.state === PaperOrderState.PARTIALLY_FILLED;
    const reportType = isPartial
      ? ExecutionReportType.ORDER_PARTIALLY_FILLED
      : ExecutionReportType.ORDER_FILLED;
    const status = isPartial ? ExecutionStatus.PARTIALLY_FILLED : ExecutionStatus.FILLED;

    try {
      await this.publisher.publish(STREAM_NAMES.EXECUTION_REPORT, {
        correlationId: order.requestId,
        eventType: 'ExecutionReport',
        exchange: ExchangeId.PAPER_TRADING,
        symbol: order.symbol,
        timestamp: Date.now(),
        producer: this.context,
        payload: this.buildReportPayload(
          reportId,
          order,
          reportType,
          status,
          executedQty,
          avgPrice,
          commission,
        ),
      });
    } catch (e) {
      this.logger.error(
        `Failed to publish paper fill report: ${(e as Error).message}`,
        undefined,
        this.context,
      );
    }
  }

  private async publishExpiredReport(order: PaperOpenOrder): Promise<void> {
    try {
      await this.publisher.publish(STREAM_NAMES.EXECUTION_REPORT, {
        correlationId: order.requestId,
        eventType: 'ExecutionReport',
        exchange: ExchangeId.PAPER_TRADING,
        symbol: order.symbol,
        timestamp: Date.now(),
        producer: this.context,
        payload: this.buildReportPayload(
          randomUUID(),
          order,
          ExecutionReportType.ORDER_EXPIRED,
          ExecutionStatus.EXPIRED,
          0,
          0,
          0,
        ),
      });
    } catch (e) {
      this.logger.error(
        `Failed to publish paper expired report: ${(e as Error).message}`,
        undefined,
        this.context,
      );
    }
  }

  private buildReportPayload(
    reportId: string,
    order: PaperOpenOrder,
    reportType: ExecutionReportType,
    status: ExecutionStatus,
    executedQty: number,
    avgPrice: number,
    commission: number,
  ): Record<string, unknown> {
    return {
      reportId,
      requestId: order.requestId,
      decisionId: order.decisionId,
      strategyId: order.strategyId,
      exchangeId: ExchangeId.PAPER_TRADING,
      symbol: order.symbol,
      side: order.side,
      orderType: order.type,
      reportType,
      status,
      exchangeOrderId: order.orderId,
      clientOrderId: order.clientOrderId,
      requestedQuantity: order.requestedQuantity,
      executedQuantity: executedQty,
      remainingQuantity: order.remainingQuantity,
      averagePrice: avgPrice,
      exchangeStatus: this.mapStatus(order.state),
      commission,
      retries: 0,
      latency: {
        totalTimeMs: 0,
        validationMs: 0,
        routeMs: 0,
        buildMs: 0,
        exchangeRequestMs: 0,
        exchangeResponseMs: 0,
        fillProcessingMs: 0,
      },
      generatedAt: Date.now(),
    };
  }

  private mapStatus(state: PaperOrderState): OrderStatus {
    switch (state) {
      case PaperOrderState.FILLED:
        return OrderStatus.FILLED;
      case PaperOrderState.PARTIALLY_FILLED:
        return OrderStatus.PARTIALLY_FILLED;
      case PaperOrderState.CANCELLED:
        return OrderStatus.CANCELLED;
      case PaperOrderState.EXPIRED:
        return OrderStatus.EXPIRED;
      default:
        return OrderStatus.NEW;
    }
  }
}
