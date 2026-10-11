import { randomUUID } from 'crypto';
import { ok, err, Result } from '@common/result';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { StreamPublisherService } from '@infrastructure/redis/streams/stream-publisher.service';
import { STREAM_NAMES } from '@infrastructure/redis/streams/stream-names.constants';
import { ExchangeAdapter } from '@modules/exchange/interfaces/exchange-adapter.interface';
import { OrderBookDepth } from '@modules/exchange/interfaces/market-data-provider.interface';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import {
  OrderSide,
  OrderStatus,
  OrderType,
  TimeInForce,
} from '@modules/exchange/enums/order.enums';
import { PositionMode, MarginMode, PositionSide } from '@modules/exchange/enums/position.enums';
import { NormalizedSymbol, MarketDataSubscription } from '@modules/exchange/models/common.model';
import { Ticker, OrderBook, Trade, FundingRate } from '@modules/exchange/models/market.models';
import {
  Order,
  SubmitOrderRequest,
  CancelOrderRequest,
  ModifyOrderRequest,
  BatchOrderResult,
} from '@modules/exchange/models/trading.models';
import {
  Balance,
  AccountInfo,
  FeeRates,
  Position,
  TradingPermission,
} from '@modules/exchange/models/account.models';
import {
  ExchangeCapabilities,
  ExchangeInfo,
  SymbolInfo,
  RateLimitStatus,
} from '@modules/exchange/models/exchange.models';
import {
  ExchangeError,
  ExchangeUnsupportedOperationError,
  InsufficientBalanceError,
} from '@modules/exchange/errors/exchange.error';
import { OrderHistoryQuery } from '@modules/exchange/interfaces/order-provider.interface';
import {
  SetLeverageRequest,
  SetMarginModeRequest,
  AdjustMarginRequest,
} from '@modules/exchange/interfaces/position-provider.interface';
import { ExecutionReportType } from '@modules/execution/domain/enums/execution-report-type.enum';
import { ExecutionStatus } from '@modules/execution/domain/enums/execution-status.enum';
import { PaperOpenOrder } from '../../domain/models/paper-open-order.model';
import { PaperOrderState } from '../../domain/enums/paper-order-state.enum';
import { PaperStateStoreService } from '../store/paper-state-store.service';
import { PaperAccountService } from '../../application/services/paper-account.service';
import {
  PaperFillEngineService,
  CurrentPrice,
} from '../../application/services/paper-fill-engine.service';
import { PaperOrderBookService } from '../../application/services/paper-order-book.service';
import { MarketDataEventBus } from '@modules/exchange/market-data-event-bus';
import { MARKET_DATA_EVENTS } from '@modules/exchange/models/common.model';

/**
 * PaperExchangeAdapter implements the full ExchangeAdapter interface against
 * a simulated paper account instead of a real exchange.
 *
 * It registers as ExchangeId.PAPER_TRADING in the AdapterRegistry so that
 * the execution engine routes decisions targeting "paper_trading" here rather
 * than to a live exchange.
 *
 * Market orders are filled synchronously using the latest ticker price seen on
 * the MarketDataEventBus. Limit and stop orders are registered in the
 * PaperOrderBookService and filled asynchronously when price crosses.
 *
 * Switching from paper to live: change the strategy's exchange field from
 * "paper_trading" to the real ExchangeId (e.g. "binance_futures_usdt").
 * No strategy code changes needed.
 *
 * Isolation guarantees:
 *  - Never reads or writes live account balances
 *  - Never reads or writes live position state
 *  - All fills published with exchangeId=PAPER_TRADING so live position
 *    manager skips them
 */
export class PaperExchangeAdapter implements ExchangeAdapter {
  readonly exchangeId = ExchangeId.PAPER_TRADING;

  private readonly context = PaperExchangeAdapter.name;

  /** Latest ticker prices per symbol — updated on every tick. */
  private readonly latestPrices = new Map<string, CurrentPrice>();

  /** Completed order records for getClosedOrders / getOrderHistory. */
  private readonly closedOrders: Order[] = [];

  private readonly tickerHandler: (ticker: Ticker) => void;

  constructor(
    private readonly logger: AppLoggerService,
    private readonly publisher: StreamPublisherService,
    private readonly store: PaperStateStoreService,
    private readonly account: PaperAccountService,
    private readonly fillEngine: PaperFillEngineService,
    private readonly orderBook: PaperOrderBookService,
    private readonly marketDataBus: MarketDataEventBus,
  ) {
    this.tickerHandler = (ticker: Ticker): void => {
      this.latestPrices.set(ticker.symbol, {
        symbol: ticker.symbol,
        bestBid: ticker.bestBid,
        bestAsk: ticker.bestAsk,
        midPrice: ticker.midPrice,
        lastPrice: ticker.lastPrice,
      });
    };
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  async initialize(): Promise<Result<void, ExchangeError>> {
    this.marketDataBus.on(MARKET_DATA_EVENTS.TICKER_UPDATED, this.tickerHandler);
    await this.account.initialize();
    await this.orderBook.initialize();
    this.logger.log('Paper exchange adapter initialized', this.context);
    return ok(undefined);
  }

  async destroy(): Promise<void> {
    this.marketDataBus.off(MARKET_DATA_EVENTS.TICKER_UPDATED, this.tickerHandler);
    await this.orderBook.expireGtcOrders();
    this.logger.log('Paper exchange adapter destroyed', this.context);
  }

  async healthCheck(): Promise<Result<string, ExchangeError>> {
    return ok(`Paper exchange OK — balance=${this.account.getAvailableBalance().toFixed(2)} USDT`);
  }

  // ── MarketDataProvider — connection ──────────────────────────────────────────

  async connect(): Promise<Result<void, ExchangeError>> {
    return ok(undefined);
  }
  async disconnect(): Promise<Result<void, ExchangeError>> {
    return ok(undefined);
  }
  isConnected(): boolean {
    return true;
  }
  async ping(): Promise<Result<number, ExchangeError>> {
    return ok(0);
  }
  async getServerTime(): Promise<Result<Date, ExchangeError>> {
    return ok(new Date());
  }

  // ── MarketDataProvider — streaming (unsupported — paper only consumes) ───────

  async subscribeToTicker(
    _symbol: NormalizedSymbol,
  ): Promise<Result<MarketDataSubscription, ExchangeError>> {
    return err(new ExchangeUnsupportedOperationError(this.exchangeId, 'subscribeToTicker'));
  }
  async subscribeToOrderBook(
    _symbol: NormalizedSymbol,
    _depth?: OrderBookDepth,
  ): Promise<Result<MarketDataSubscription, ExchangeError>> {
    return err(new ExchangeUnsupportedOperationError(this.exchangeId, 'subscribeToOrderBook'));
  }
  async subscribeToTrades(
    _symbol: NormalizedSymbol,
  ): Promise<Result<MarketDataSubscription, ExchangeError>> {
    return err(new ExchangeUnsupportedOperationError(this.exchangeId, 'subscribeToTrades'));
  }
  async subscribeToFundingRate(
    _symbol: NormalizedSymbol,
  ): Promise<Result<MarketDataSubscription, ExchangeError>> {
    return err(new ExchangeUnsupportedOperationError(this.exchangeId, 'subscribeToFundingRate'));
  }
  async subscribeToMarkPrice(
    _symbol: NormalizedSymbol,
  ): Promise<Result<MarketDataSubscription, ExchangeError>> {
    return err(new ExchangeUnsupportedOperationError(this.exchangeId, 'subscribeToMarkPrice'));
  }
  async unsubscribeAll(): Promise<void> {
    /* no-op */
  }

  // ── MarketDataProvider — snapshots (unsupported) ─────────────────────────────

  async getTicker(symbol: NormalizedSymbol): Promise<Result<Ticker, ExchangeError>> {
    const price = this.latestPrices.get(symbol);
    if (!price) {
      return err(
        new ExchangeUnsupportedOperationError(
          this.exchangeId,
          `No ticker data for ${symbol} — market data not yet received`,
        ),
      );
    }
    const now = new Date();
    const spread = price.bestAsk - price.bestBid;
    // Return a minimal Ticker using the latest bid/ask snapshot.
    // Fields that require real 24h stats (volume, OHLC, etc.) are zeroed —
    // the only consumer of getTicker in this codebase is the order builder,
    // which reads lastPrice to compute execution quantity.
    return ok({
      exchangeId: this.exchangeId,
      symbol,
      timestamp: now,
      receivedAt: now,
      bestBid: price.bestBid,
      bestAsk: price.bestAsk,
      bestBidQuantity: 0,
      bestAskQuantity: 0,
      spread,
      midPrice: price.midPrice,
      openPrice: price.lastPrice,
      highPrice: price.lastPrice,
      lowPrice: price.lastPrice,
      closePrice: price.lastPrice,
      lastPrice: price.lastPrice,
      lastQuantity: 0,
      volume: 0,
      quoteVolume: 0,
      priceChange: 0,
      priceChangePercent: 0,
      weightedAveragePrice: price.lastPrice,
      openTime: now,
      closeTime: now,
      tradeCount: 0,
    });
  }
  async getOrderBook(
    _symbol: NormalizedSymbol,
    _depth?: OrderBookDepth,
  ): Promise<Result<OrderBook, ExchangeError>> {
    return err(new ExchangeUnsupportedOperationError(this.exchangeId, 'getOrderBook'));
  }
  async getRecentTrades(
    _symbol: NormalizedSymbol,
    _limit?: number,
  ): Promise<Result<Trade[], ExchangeError>> {
    return err(new ExchangeUnsupportedOperationError(this.exchangeId, 'getRecentTrades'));
  }
  async getFundingRate(_symbol: NormalizedSymbol): Promise<Result<FundingRate, ExchangeError>> {
    return err(new ExchangeUnsupportedOperationError(this.exchangeId, 'getFundingRate'));
  }
  async getSupportedSymbols(): Promise<Result<NormalizedSymbol[], ExchangeError>> {
    return ok([]);
  }
  async getSymbolInfo(_symbol: NormalizedSymbol): Promise<Result<SymbolInfo, ExchangeError>> {
    return err(new ExchangeUnsupportedOperationError(this.exchangeId, 'getSymbolInfo'));
  }

  // ── TradingProvider ──────────────────────────────────────────────────────────

  /**
   * Submit a paper order.
   *
   * Market orders: fill synchronously using latest ticker price.
   * Limit / Stop / TrailingStop: register in PaperOrderBookService, return NEW.
   */
  async submitOrder(request: SubmitOrderRequest): Promise<Result<Order, ExchangeError>> {
    await this.fillEngine.simulateLatency();

    const orderId = randomUUID();
    const clientOrderId = request.clientOrderId ?? randomUUID();
    const now = Date.now();
    const correlationId = request.correlationId ?? randomUUID();
    const requestId = correlationId;

    // Determine order type
    const isMarket = request.type === OrderType.MARKET;
    const isLimit = request.type === OrderType.LIMIT;
    const isStop = request.type === OrderType.STOP || request.type === OrderType.STOP_LIMIT;
    const isTrailing = request.type === OrderType.TRAILING_STOP;

    // ── Market order: fill immediately ──────────────────────────────────────────
    if (isMarket) {
      const price = this.latestPrices.get(request.symbol);
      if (!price) {
        return err(
          new ExchangeUnsupportedOperationError(
            this.exchangeId,
            `No ticker price available for ${request.symbol} — ensure market data is subscribed`,
          ),
        );
      }

      const tempOrder: PaperOpenOrder = {
        orderId,
        clientOrderId,
        requestId,
        decisionId: correlationId,
        strategyId: 'unknown', // filled by execution engine from decision
        symbol: request.symbol,
        side: request.side,
        type: request.type,
        timeInForce: request.timeInForce ?? TimeInForce.GTC,
        requestedQuantity: request.quantity,
        filledQuantity: 0,
        remainingQuantity: request.quantity,
        reduceOnly: request.reduceOnly ?? false,
        postOnly: request.postOnly ?? false,
        state: PaperOrderState.NEW,
        createdAt: now,
        updatedAt: now,
      };

      const result = this.fillEngine.fillMarketOrder(tempOrder, price, correlationId, requestId);
      const { fill, updatedOrder, fillPrice } = result;

      // Apply fill to account balance
      const isBuy = request.side === OrderSide.BUY;
      try {
        this.account.applyFill({
          isBuy,
          quoteAmount: fill.notional,
          commission: fill.commission,
          realizedPnl: 0,
          fromLocked: false,
        });
      } catch (e) {
        return err(
          new InsufficientBalanceError(
            this.exchangeId,
            'USDT',
            fill.notional,
            this.account.getAvailableBalance(),
          ),
        );
      }

      // Persist fill record
      await this.store.appendFill(fill);

      // Also publish to PAPER_EXECUTION_REPORT for direct tracking
      await this.publishMarketFillReport(
        orderId,
        clientOrderId,
        requestId,
        request,
        fillPrice,
        fill.filledQuantity,
        fill.commission,
      );

      // Return FILLED order to the execution engine
      return ok(
        this.buildFilledOrder(
          orderId,
          clientOrderId,
          request,
          fillPrice,
          updatedOrder.filledQuantity,
          updatedOrder.remainingQuantity,
          fill.commission,
          now,
        ),
      );
    }

    // ── Limit / Stop / TrailingStop: register as pending ────────────────────────
    const pendingOrder: PaperOpenOrder = {
      orderId,
      clientOrderId,
      requestId,
      decisionId: correlationId,
      strategyId: 'unknown',
      symbol: request.symbol,
      side: request.side,
      type: request.type,
      timeInForce: request.timeInForce ?? TimeInForce.GTC,
      requestedQuantity: request.quantity,
      filledQuantity: 0,
      remainingQuantity: request.quantity,
      limitPrice: isLimit ? request.price : undefined,
      stopPrice: isStop || isTrailing ? request.stopPrice : undefined,
      trailingDeltaBps: isTrailing ? request.trailingDelta : undefined,
      reduceOnly: request.reduceOnly ?? false,
      postOnly: request.postOnly ?? false,
      state: PaperOrderState.NEW,
      createdAt: now,
      updatedAt: now,
    };

    // Lock balance for limit BUY orders
    if (isLimit && request.side === OrderSide.BUY && request.price) {
      const lockAmount = request.quantity * request.price;
      try {
        this.account.lockForBuyOrder(lockAmount);
      } catch {
        return err(
          new InsufficientBalanceError(
            this.exchangeId,
            'USDT',
            lockAmount,
            this.account.getAvailableBalance(),
          ),
        );
      }
    }

    await this.orderBook.addOrder(pendingOrder);

    this.logger.log(
      `[PAPER-ORDER-ACCEPTED] ${request.side} ${request.quantity} ${request.symbol} type=${request.type} ` +
        `limit=${request.price ?? '-'} stop=${request.stopPrice ?? '-'}`,
      this.context,
    );

    // Return NEW order — the order book handles async fills
    return ok(this.buildNewOrder(orderId, clientOrderId, request, now));
  }

  async cancelOrder(request: CancelOrderRequest): Promise<Result<Order, ExchangeError>> {
    const orderId = request.exchangeOrderId ?? request.clientOrderId;
    if (!orderId) {
      return err(
        new ExchangeUnsupportedOperationError(
          this.exchangeId,
          'cancelOrder requires exchangeOrderId or clientOrderId',
        ),
      );
    }

    // Find by client ID if necessary
    let resolvedId = request.exchangeOrderId;
    if (!resolvedId && request.clientOrderId) {
      const all = this.orderBook.getOpenOrders(request.symbol);
      resolvedId = all.find((o) => o.clientOrderId === request.clientOrderId)?.orderId;
    }

    if (!resolvedId) {
      return err(
        new ExchangeUnsupportedOperationError(this.exchangeId, `Order not found: ${orderId}`),
      );
    }

    const cancelled = await this.orderBook.cancelOrder(resolvedId);
    if (!cancelled) {
      return err(
        new ExchangeUnsupportedOperationError(this.exchangeId, `Order not found: ${resolvedId}`),
      );
    }

    return ok(this.buildCancelledOrder(cancelled));
  }

  async cancelAllOrders(symbol?: NormalizedSymbol): Promise<Result<Order[], ExchangeError>> {
    const cancelled = await this.orderBook.cancelAll(symbol);
    return ok(cancelled.map((o) => this.buildCancelledOrder(o)));
  }

  async modifyOrder(_request: ModifyOrderRequest): Promise<Result<Order, ExchangeError>> {
    return err(new ExchangeUnsupportedOperationError(this.exchangeId, 'modifyOrder'));
  }

  async submitBatch(
    _requests: SubmitOrderRequest[],
  ): Promise<Result<BatchOrderResult, ExchangeError>> {
    return err(new ExchangeUnsupportedOperationError(this.exchangeId, 'submitBatch'));
  }

  async cancelBatch(
    _requests: CancelOrderRequest[],
  ): Promise<Result<BatchOrderResult, ExchangeError>> {
    return err(new ExchangeUnsupportedOperationError(this.exchangeId, 'cancelBatch'));
  }

  // ── OrderProvider ────────────────────────────────────────────────────────────

  async getOpenOrders(symbol?: NormalizedSymbol): Promise<Result<Order[], ExchangeError>> {
    const orders = this.orderBook.getOpenOrders(symbol);
    return ok(
      orders.map((o) =>
        this.buildNewOrder(
          o.orderId,
          o.clientOrderId,
          {
            symbol: o.symbol,
            side: o.side,
            type: o.type,
            quantity: o.requestedQuantity,
            price: o.limitPrice,
            stopPrice: o.stopPrice,
            timeInForce: o.timeInForce,
            reduceOnly: o.reduceOnly,
            postOnly: o.postOnly,
          },
          o.createdAt,
        ),
      ),
    );
  }

  async getClosedOrders(
    _symbol?: NormalizedSymbol,
    limit = 100,
  ): Promise<Result<Order[], ExchangeError>> {
    return ok(this.closedOrders.slice(-limit));
  }

  async getOrderHistory(query: OrderHistoryQuery): Promise<Result<Order[], ExchangeError>> {
    // We don't have the full Order model in fills; return empty (would need more state)
    void this.store.loadFills(query.limit ?? 500);
    return ok([]);
  }

  async getOrder(
    _exchangeOrderId: string,
    _symbol: NormalizedSymbol,
  ): Promise<Result<Order, ExchangeError>> {
    return err(new ExchangeUnsupportedOperationError(this.exchangeId, 'getOrder'));
  }

  async getOrderByClientId(
    _clientOrderId: string,
    _symbol: NormalizedSymbol,
  ): Promise<Result<Order, ExchangeError>> {
    return err(new ExchangeUnsupportedOperationError(this.exchangeId, 'getOrderByClientId'));
  }

  // ── AccountProvider ──────────────────────────────────────────────────────────

  async getBalance(): Promise<Result<Balance, ExchangeError>> {
    const state = this.account.getState();
    return ok({
      exchangeId: this.exchangeId,
      timestamp: new Date(state.updatedAt),
      receivedAt: new Date(),
      assets: {
        USDT: {
          asset: 'USDT',
          free: state.balance,
          locked: state.lockedBalance,
          total: state.balance + state.lockedBalance,
        },
      },
      totalEquity: state.equity,
      totalUnrealizedPnl: 0,
      totalMarginBalance: state.balance + state.lockedBalance,
      availableBalance: state.balance,
    });
  }

  async getAccountInfo(): Promise<Result<AccountInfo, ExchangeError>> {
    return ok({
      exchangeId: this.exchangeId,
      timestamp: new Date(),
      receivedAt: new Date(),
      accountId: 'paper-account',
      accountType: 'PAPER',
      permissions: ['FUTURES'],
      canTrade: true,
      canWithdraw: false,
      canDeposit: false,
      updateTime: new Date(),
    });
  }

  async getFeeRates(_symbol?: NormalizedSymbol): Promise<Result<FeeRates, ExchangeError>> {
    return ok({
      exchangeId: this.exchangeId,
      timestamp: new Date(),
      receivedAt: new Date(),
      defaultFees: {
        makerFee: 0.0002,
        takerFee: 0.0005,
      },
      symbolFees: {},
    });
  }

  async getTradingPermissions(): Promise<Result<TradingPermission[], ExchangeError>> {
    return ok(['FUTURES']);
  }

  // ── PositionProvider ─────────────────────────────────────────────────────────

  async getOpenPositions(_symbol?: NormalizedSymbol): Promise<Result<Position[], ExchangeError>> {
    const positions = await this.store.loadAllPositions();
    const open = positions.filter((p) => p.direction !== 'FLAT' && p.quantity > 0);
    const now = new Date();
    const mapped: Position[] = open.map((p) => ({
      exchangeId: this.exchangeId,
      symbol: NormalizedSymbol.unsafe(p.symbol),
      timestamp: now,
      receivedAt: now,
      positionSide: p.direction === 'LONG' ? PositionSide.LONG : PositionSide.SHORT,
      marginMode: MarginMode.CROSS,
      leverage: 1,
      entryPrice: p.averageEntryPrice,
      quantity: p.quantity,
      notionalValue: p.quantity * p.averageEntryPrice,
      unrealizedPnl: p.unrealizedPnl,
      realizedPnl: p.realizedPnl,
      marginUsed: p.quantity * p.averageEntryPrice,
      maintenanceMargin: 0,
      positionValue: p.quantity * p.averageEntryPrice,
    }));
    return ok(mapped);
  }

  async getPositionHistory(
    _symbol: NormalizedSymbol,
    _limit?: number,
  ): Promise<Result<Position[], ExchangeError>> {
    return ok([]);
  }

  async getPositionMode(): Promise<Result<PositionMode, ExchangeError>> {
    return ok(PositionMode.ONE_WAY);
  }

  async setPositionMode(_mode: PositionMode): Promise<Result<void, ExchangeError>> {
    return ok(undefined); // no-op
  }

  async getLeverage(_symbol: NormalizedSymbol): Promise<Result<number, ExchangeError>> {
    return ok(1);
  }

  async setLeverage(_request: SetLeverageRequest): Promise<Result<number, ExchangeError>> {
    return ok(1); // paper trading is always 1x effective leverage
  }

  async getMarginMode(_symbol: NormalizedSymbol): Promise<Result<MarginMode, ExchangeError>> {
    return ok(MarginMode.CROSS);
  }

  async setMarginMode(_request: SetMarginModeRequest): Promise<Result<void, ExchangeError>> {
    return ok(undefined);
  }

  async adjustMargin(_request: AdjustMarginRequest): Promise<Result<void, ExchangeError>> {
    return ok(undefined);
  }

  // ── ExchangeMetadataProvider ─────────────────────────────────────────────────

  async getExchangeInfo(): Promise<Result<ExchangeInfo, ExchangeError>> {
    return ok({
      exchangeId: this.exchangeId,
      serverTime: new Date(),
      timezone: 'UTC',
      rateLimits: [],
      symbols: [],
      isMaintenance: false,
    });
  }

  async getAllSymbols(): Promise<Result<SymbolInfo[], ExchangeError>> {
    return ok([]);
  }

  getRateLimitStatus(): Result<RateLimitStatus[], ExchangeError> {
    return ok([]); // no rate limits for paper trading
  }

  isMaintenanceMode(): boolean {
    return false;
  }

  // ── ExchangeCapabilityProvider ───────────────────────────────────────────────

  getExchangeId(): ExchangeId {
    return this.exchangeId;
  }

  getCapabilities(): ExchangeCapabilities {
    return {
      supportsSpot: true,
      supportsPerpetual: true,
      supportsFutures: true,
      supportsOptions: false,
      supportsMargin: false,
      supportsCrossMargin: true,
      supportsIsolatedMargin: false,
      supportsOco: false,
      supportsTpSl: false,
      supportsBatchOrders: false,
      supportsReduceOnly: true,
      supportsHedgeMode: false,
      supportsTrailingStop: true,
      supportsPostOnly: true,
      supportsConditionalOrders: false,
      supportsWebSocket: false,
      maxBatchOrderSize: 0,
    };
  }

  isFeatureSupported(feature: keyof ExchangeCapabilities): boolean {
    return !!this.getCapabilities()[feature];
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private buildFilledOrder(
    orderId: string,
    clientOrderId: string,
    request: SubmitOrderRequest,
    fillPrice: number,
    executedQty: number,
    remainingQty: number,
    commission: number,
    now: number,
  ): Order {
    return {
      exchangeId: this.exchangeId,
      symbol: request.symbol,
      timestamp: new Date(now),
      receivedAt: new Date(now),
      exchangeOrderId: orderId,
      clientOrderId,
      updatedAt: new Date(now),
      side: request.side,
      type: request.type,
      status: OrderStatus.FILLED,
      timeInForce: request.timeInForce ?? TimeInForce.GTC,
      originalQuantity: request.quantity,
      executedQuantity: executedQty,
      remainingQuantity: remainingQty,
      cumulativeQuoteQuantity: executedQty * fillPrice,
      price: request.price ?? fillPrice,
      averagePrice: fillPrice,
      stopPrice: request.stopPrice,
      reduceOnly: request.reduceOnly,
      postOnly: request.postOnly,
      feeAmount: commission,
      feeAsset: 'USDT',
    };
  }

  private buildNewOrder(
    orderId: string,
    clientOrderId: string,
    request: Pick<
      SubmitOrderRequest,
      | 'symbol'
      | 'side'
      | 'type'
      | 'quantity'
      | 'price'
      | 'stopPrice'
      | 'timeInForce'
      | 'reduceOnly'
      | 'postOnly'
    >,
    now: number,
  ): Order {
    return {
      exchangeId: this.exchangeId,
      symbol: request.symbol,
      timestamp: new Date(now),
      receivedAt: new Date(now),
      exchangeOrderId: orderId,
      clientOrderId,
      updatedAt: new Date(now),
      side: request.side,
      type: request.type,
      status: OrderStatus.NEW,
      timeInForce: request.timeInForce ?? TimeInForce.GTC,
      originalQuantity: request.quantity,
      executedQuantity: 0,
      remainingQuantity: request.quantity,
      cumulativeQuoteQuantity: 0,
      price: request.price ?? 0,
      averagePrice: 0,
      stopPrice: request.stopPrice,
      reduceOnly: request.reduceOnly,
      postOnly: request.postOnly,
    };
  }

  private buildCancelledOrder(order: PaperOpenOrder): Order {
    const now = Date.now();
    return {
      exchangeId: this.exchangeId,
      symbol: order.symbol,
      timestamp: new Date(now),
      receivedAt: new Date(now),
      exchangeOrderId: order.orderId,
      clientOrderId: order.clientOrderId,
      updatedAt: new Date(now),
      side: order.side,
      type: order.type,
      status: OrderStatus.CANCELLED,
      timeInForce: order.timeInForce,
      originalQuantity: order.requestedQuantity,
      executedQuantity: order.filledQuantity,
      remainingQuantity: order.remainingQuantity,
      cumulativeQuoteQuantity: order.filledQuantity * (order.limitPrice ?? 0),
      price: order.limitPrice ?? 0,
      averagePrice: 0,
      stopPrice: order.stopPrice,
      reduceOnly: order.reduceOnly,
      postOnly: order.postOnly,
    };
  }

  /**
   * Publishes an execution report for a paper market fill directly to
   * PAPER_EXECUTION_REPORT so PaperPositionManagerService can pick it up
   * separately from the execution engine's EXECUTION_REPORT publication.
   */
  private async publishMarketFillReport(
    orderId: string,
    clientOrderId: string,
    requestId: string,
    request: SubmitOrderRequest,
    fillPrice: number,
    executedQty: number,
    commission: number,
  ): Promise<void> {
    try {
      await this.publisher.publish(STREAM_NAMES.PAPER_EXECUTION_REPORT, {
        correlationId: requestId,
        eventType: 'PaperExecutionReport',
        exchange: ExchangeId.PAPER_TRADING,
        symbol: request.symbol,
        timestamp: Date.now(),
        producer: this.context,
        payload: {
          reportId: randomUUID(),
          requestId,
          decisionId: requestId,
          strategyId: 'unknown', // execution engine fills this
          exchangeId: ExchangeId.PAPER_TRADING,
          symbol: request.symbol,
          side: request.side,
          orderType: request.type,
          reportType: ExecutionReportType.ORDER_FILLED,
          status: ExecutionStatus.FILLED,
          exchangeOrderId: orderId,
          clientOrderId,
          requestedQuantity: request.quantity,
          executedQuantity: executedQty,
          remainingQuantity: 0,
          averagePrice: fillPrice,
          exchangeStatus: OrderStatus.FILLED,
          commission,
          retries: 0,
          generatedAt: Date.now(),
        } as Record<string, unknown>,
      });
    } catch (e) {
      this.logger.error(
        `Failed to publish paper market fill report: ${(e as Error).message}`,
        undefined,
        this.context,
      );
    }
  }
}
