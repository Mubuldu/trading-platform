import { ILogger } from '@core/logging/logger.interface';
import { Result, ok, err } from '@common/result';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { OrderStatus } from '@modules/exchange/enums/order.enums';
import { MarginMode, PositionMode } from '@modules/exchange/enums/position.enums';
import {
  ExchangeCapabilities,
  ExchangeInfo,
  SymbolInfo,
  RateLimitStatus,
} from '@modules/exchange/models/exchange.models';
import {
  NormalizedSymbol,
  MarketDataSubscription,
  MARKET_DATA_EVENTS,
} from '@modules/exchange/models/common.model';
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
  TradingPermission,
  Position,
} from '@modules/exchange/models/account.models';
import { OrderBookDepth } from '@modules/exchange/interfaces/market-data-provider.interface';
import { OrderHistoryQuery } from '@modules/exchange/interfaces/order-provider.interface';
import {
  SetLeverageRequest,
  SetMarginModeRequest,
  AdjustMarginRequest,
} from '@modules/exchange/interfaces/position-provider.interface';
import { BaseExchangeAdapter } from '@modules/exchange/adapters/base-exchange.adapter';
import { SymbolNormalizer } from '@modules/exchange/normalizers/symbol.normalizer';
import { OrderStatusNormalizer } from '@modules/exchange/normalizers/order-status.normalizer';
import { OrderValidator } from '@modules/exchange/validators/order.validator';
import {
  ExchangeError,
  ExchangeUnsupportedOperationError,
  UnknownSymbolError,
} from '@modules/exchange/errors/exchange.error';
import { BinanceRestClient } from './client/binance-rest.client';
import { BinanceServerTimeService } from './server-time/binance-server-time.service';
import { BinanceRateLimitManager } from './rate-limit/binance-rate-limit.manager';
import { BinanceExchangeInfoMapper } from './mappers/binance-exchange-info.mapper';
import { BinanceOrderMapper, BINANCE_ORDER_STATUS_MAP } from './mappers/binance-order.mapper';
import { BinanceTicker24hrMapper } from './mappers/binance-ticker.mapper';
import { BinanceOrderBookMapper } from './mappers/binance-order-book.mapper';
import { BinanceTradeMapper } from './mappers/binance-trade.mapper';
import { BinanceAccountMapper } from './mappers/binance-account.mapper';
import { BINANCE_ENDPOINTS, BINANCE_REQUEST_WEIGHTS } from './config/binance.constants';
import { BinanceWsStreamManager } from './ws/binance-ws-stream-manager';
import {
  buildTickerStream,
  buildDiffDepthStream,
  buildTradeStream,
} from './ws/binance-ws.constants';
import {
  BinanceRawExchangeInfo,
  BinanceRawServerTime,
  BinanceRawTicker24hr,
  BinanceRawOrderBook,
  BinanceRawTrade,
  BinanceRawAccount,
  BinanceRawOrder,
  BinanceRawCancelReplaceResponse,
} from './client/binance-http.types';

const UNSUPPORTED = (op: string): ExchangeUnsupportedOperationError =>
  new ExchangeUnsupportedOperationError(ExchangeId.BINANCE_SPOT, op);

const EXCHANGE_INFO_TTL_MS = 5 * 60 * 1_000;

/**
 * BinanceSpotAdapter implements the ExchangeAdapter contract for Binance Spot.
 *
 * Milestone 5: REST only. WebSocket subscriptions return ExchangeUnsupportedOperationError
 * with a clear message — they will be implemented in the WebSocket milestone.
 *
 * Futures-specific operations (positions, leverage, funding rate, margin mode)
 * return ExchangeUnsupportedOperationError permanently for this adapter.
 * Futures trading requires separate BinanceFuturesUsdtAdapter or BinanceFuturesCoinAdapter.
 *
 * Initialization sequence (initializeInternal):
 *  1. Sync server clock via unsigned GET /api/v3/time
 *  2. Fetch exchange info (symbols, rate limits) via GET /api/v3/exchangeInfo
 *  3. Seed SymbolNormalizer with all spot symbols
 *  4. Register Binance order status mappings with OrderStatusNormalizer
 *
 * Symbol resolution: all public methods that take NormalizedSymbol use
 * SymbolNormalizer.toExchangeSymbol() to get the Binance-specific symbol string
 * before making API calls.
 */
export class BinanceSpotAdapter extends BaseExchangeAdapter {
  readonly exchangeId = ExchangeId.BINANCE_SPOT;

  readonly capabilities: ExchangeCapabilities = {
    supportsSpot: true,
    supportsPerpetual: false,
    supportsFutures: false,
    supportsOptions: false,
    supportsMargin: false,
    supportsCrossMargin: false,
    supportsIsolatedMargin: false,
    supportsOco: true,
    supportsTpSl: false,
    supportsBatchOrders: false,
    supportsReduceOnly: false,
    supportsHedgeMode: false,
    supportsTrailingStop: false,
    supportsPostOnly: true,
    supportsConditionalOrders: false,
    supportsWebSocket: true,
    maxBatchOrderSize: 0,
  };

  private cachedExchangeInfo: ExchangeInfo | null = null;
  private exchangeInfoFetchedAt = 0;

  constructor(
    logger: ILogger,
    symbolNormalizer: SymbolNormalizer,
    orderStatusNormalizer: OrderStatusNormalizer,
    orderValidator: OrderValidator,
    private readonly restClient: BinanceRestClient,
    private readonly serverTimeService: BinanceServerTimeService,
    private readonly rateLimitManager: BinanceRateLimitManager,
    private readonly exchangeInfoMapper: BinanceExchangeInfoMapper,
    private readonly orderMapper: BinanceOrderMapper,
    private readonly tickerMapper: BinanceTicker24hrMapper,
    private readonly orderBookMapper: BinanceOrderBookMapper,
    private readonly tradeMapper: BinanceTradeMapper,
    private readonly accountMapper: BinanceAccountMapper,
    private readonly wsStreamManager: BinanceWsStreamManager,
  ) {
    super(logger, symbolNormalizer, orderStatusNormalizer, orderValidator);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  protected async initializeInternal(): Promise<void> {
    await this.syncServerTime();

    const infoResult = await this.fetchAndCacheExchangeInfo();
    if (infoResult.isErr()) throw infoResult.error;

    this.orderStatusNormalizer.registerMappings(ExchangeId.BINANCE_SPOT, BINANCE_ORDER_STATUS_MAP);
  }

  protected async connectInternal(): Promise<void> {
    const pingResult = await this.ping();
    if (pingResult.isErr()) throw pingResult.error;
    this.wsStreamManager.connect();
  }

  protected async disconnectInternal(): Promise<void> {
    this.wsStreamManager.disconnect();
    this.restClient.destroy();
  }

  // ── MarketDataProvider — REST snapshots ───────────────────────────────────

  async ping(): Promise<Result<number, ExchangeError>> {
    const start = Date.now();
    const result = await this.restClient.execute<Record<string, never>>({
      method: 'GET',
      endpoint: BINANCE_ENDPOINTS.PING,
      params: {},
      signed: false,
      weight: BINANCE_REQUEST_WEIGHTS.PING,
    });
    if (result.isErr()) return err(result.error);
    return ok(Date.now() - start);
  }

  async getServerTime(): Promise<Result<Date, ExchangeError>> {
    const result = await this.restClient.execute<BinanceRawServerTime>({
      method: 'GET',
      endpoint: BINANCE_ENDPOINTS.SERVER_TIME,
      params: {},
      signed: false,
      weight: BINANCE_REQUEST_WEIGHTS.SERVER_TIME,
    });
    if (result.isErr()) return err(result.error);
    return ok(new Date(result.value.serverTime));
  }

  async getTicker(symbol: NormalizedSymbol): Promise<Result<Ticker, ExchangeError>> {
    const symbolCheck = this.validateSymbol(symbol);
    if (symbolCheck.isErr()) return err(symbolCheck.error);

    const exchangeSymbolResult = this.symbolNormalizer.toExchangeSymbol(symbol, this.exchangeId);
    if (exchangeSymbolResult.isErr()) return err(exchangeSymbolResult.error);

    const result = await this.restClient.execute<BinanceRawTicker24hr>({
      method: 'GET',
      endpoint: BINANCE_ENDPOINTS.TICKER_24HR,
      params: { symbol: exchangeSymbolResult.value },
      signed: false,
      weight: BINANCE_REQUEST_WEIGHTS.TICKER_24HR_SINGLE,
    });
    if (result.isErr()) return err(result.error);

    return this.tickerMapper.map(result.value, symbol, new Date());
  }

  async getOrderBook(
    symbol: NormalizedSymbol,
    depth?: OrderBookDepth,
  ): Promise<Result<OrderBook, ExchangeError>> {
    const symbolCheck = this.validateSymbol(symbol);
    if (symbolCheck.isErr()) return err(symbolCheck.error);

    const exchangeSymbolResult = this.symbolNormalizer.toExchangeSymbol(symbol, this.exchangeId);
    if (exchangeSymbolResult.isErr()) return err(exchangeSymbolResult.error);

    const limit = depth ?? 20;
    const weights = BINANCE_REQUEST_WEIGHTS.ORDER_BOOK;
    const weight = weights[limit as keyof typeof weights] ?? 10;

    const result = await this.restClient.execute<BinanceRawOrderBook>({
      method: 'GET',
      endpoint: BINANCE_ENDPOINTS.ORDER_BOOK,
      params: { symbol: exchangeSymbolResult.value, limit },
      signed: false,
      weight,
    });
    if (result.isErr()) return err(result.error);

    return this.orderBookMapper.map(result.value, symbol, new Date());
  }

  async getRecentTrades(
    symbol: NormalizedSymbol,
    limit = 500,
  ): Promise<Result<Trade[], ExchangeError>> {
    const symbolCheck = this.validateSymbol(symbol);
    if (symbolCheck.isErr()) return err(symbolCheck.error);

    const exchangeSymbolResult = this.symbolNormalizer.toExchangeSymbol(symbol, this.exchangeId);
    if (exchangeSymbolResult.isErr()) return err(exchangeSymbolResult.error);

    const result = await this.restClient.execute<BinanceRawTrade[]>({
      method: 'GET',
      endpoint: BINANCE_ENDPOINTS.RECENT_TRADES,
      params: { symbol: exchangeSymbolResult.value, limit: Math.min(limit, 1000) },
      signed: false,
      weight: BINANCE_REQUEST_WEIGHTS.RECENT_TRADES,
    });
    if (result.isErr()) return err(result.error);

    return this.tradeMapper.mapMany(result.value, symbol, new Date());
  }

  async getSupportedSymbols(): Promise<Result<NormalizedSymbol[], ExchangeError>> {
    const infoResult = await this.getExchangeInfo();
    if (infoResult.isErr()) return err(infoResult.error);
    return ok(infoResult.value.symbols.map((s) => s.symbol));
  }

  async getSymbolInfo(symbol: NormalizedSymbol): Promise<Result<SymbolInfo, ExchangeError>> {
    const infoResult = await this.getExchangeInfo();
    if (infoResult.isErr()) return err(infoResult.error);

    const symbolInfo = infoResult.value.symbols.find((s) => s.symbol === symbol);
    if (!symbolInfo) {
      return err(new UnknownSymbolError(this.exchangeId, symbol));
    }
    return ok(symbolInfo);
  }

  // ── TradingProvider ───────────────────────────────────────────────────────

  async submitOrder(request: SubmitOrderRequest): Promise<Result<Order, ExchangeError>> {
    const symbolCheck = this.validateSymbol(request.symbol);
    if (symbolCheck.isErr()) return err(symbolCheck.error);

    const exchangeSymbolResult = this.symbolNormalizer.toExchangeSymbol(
      request.symbol,
      this.exchangeId,
    );
    if (exchangeSymbolResult.isErr()) return err(exchangeSymbolResult.error);

    const symbolInfoResult = await this.getSymbolInfo(request.symbol);
    if (symbolInfoResult.isErr()) return err(symbolInfoResult.error);

    const validationResult = this.orderValidator.validate(
      request,
      symbolInfoResult.value,
      this.exchangeId,
    );
    if (validationResult.isErr()) return err(validationResult.error);

    const params: Record<string, string | number | boolean> = {
      symbol: exchangeSymbolResult.value,
      side: request.side,
      type: this.toExchangeOrderType(request),
      quantity: request.quantity,
    };

    if (request.price !== undefined) params.price = request.price;
    if (request.stopPrice !== undefined) params.stopPrice = request.stopPrice;
    if (request.timeInForce) params.timeInForce = this.toExchangeTimeInForce(request);
    if (request.clientOrderId) params.newClientOrderId = request.clientOrderId;
    if (request.icebergQuantity) params.icebergQty = request.icebergQuantity;
    params.newOrderRespType = 'RESULT';

    const result = await this.restClient.execute<BinanceRawOrder>({
      method: 'POST',
      endpoint: BINANCE_ENDPOINTS.ORDER,
      params,
      signed: true,
      weight: BINANCE_REQUEST_WEIGHTS.CREATE_ORDER,
      isOrderEndpoint: true,
    });
    if (result.isErr()) return err(result.error);

    return this.mapOrderWithSymbol(result.value, request.symbol);
  }

  async cancelOrder(request: CancelOrderRequest): Promise<Result<Order, ExchangeError>> {
    const symbolCheck = this.validateSymbol(request.symbol);
    if (symbolCheck.isErr()) return err(symbolCheck.error);

    const exchangeSymbolResult = this.symbolNormalizer.toExchangeSymbol(
      request.symbol,
      this.exchangeId,
    );
    if (exchangeSymbolResult.isErr()) return err(exchangeSymbolResult.error);

    const params: Record<string, string | number | boolean> = {
      symbol: exchangeSymbolResult.value,
    };
    if (request.exchangeOrderId) params.orderId = request.exchangeOrderId;
    if (request.clientOrderId) params.origClientOrderId = request.clientOrderId;

    const result = await this.restClient.execute<BinanceRawOrder>({
      method: 'DELETE',
      endpoint: BINANCE_ENDPOINTS.ORDER,
      params,
      signed: true,
      weight: BINANCE_REQUEST_WEIGHTS.CANCEL_ORDER,
    });
    if (result.isErr()) return err(result.error);

    return this.mapOrderWithSymbol(result.value, request.symbol);
  }

  async cancelAllOrders(symbol?: NormalizedSymbol): Promise<Result<Order[], ExchangeError>> {
    if (!symbol) {
      return err(UNSUPPORTED('cancelAllOrders without symbol — Binance requires a symbol'));
    }

    const symbolCheck = this.validateSymbol(symbol);
    if (symbolCheck.isErr()) return err(symbolCheck.error);

    const exchangeSymbolResult = this.symbolNormalizer.toExchangeSymbol(symbol, this.exchangeId);
    if (exchangeSymbolResult.isErr()) return err(exchangeSymbolResult.error);

    const result = await this.restClient.execute<BinanceRawOrder[]>({
      method: 'DELETE',
      endpoint: BINANCE_ENDPOINTS.OPEN_ORDERS,
      params: { symbol: exchangeSymbolResult.value },
      signed: true,
      weight: BINANCE_REQUEST_WEIGHTS.CANCEL_ALL_ORDERS,
    });
    if (result.isErr()) return err(result.error);

    return this.mapOrdersWithSymbol(result.value, symbol);
  }

  async modifyOrder(request: ModifyOrderRequest): Promise<Result<Order, ExchangeError>> {
    const symbolCheck = this.validateSymbol(request.symbol);
    if (symbolCheck.isErr()) return err(symbolCheck.error);

    const exchangeSymbolResult = this.symbolNormalizer.toExchangeSymbol(
      request.symbol,
      this.exchangeId,
    );
    if (exchangeSymbolResult.isErr()) return err(exchangeSymbolResult.error);

    const params: Record<string, string | number | boolean> = {
      symbol: exchangeSymbolResult.value,
      side: 'BUY',
      type: 'LIMIT',
      cancelReplaceMode: 'STOP_ON_FAILURE',
    };

    if (request.exchangeOrderId) params.cancelOrderId = request.exchangeOrderId;
    if (request.clientOrderId) params.cancelOrigClientOrderId = request.clientOrderId;
    if (request.price !== undefined) params.price = request.price;
    if (request.quantity !== undefined) params.quantity = request.quantity;
    if (request.price !== undefined) params.timeInForce = 'GTC';

    const result = await this.restClient.execute<BinanceRawCancelReplaceResponse>({
      method: 'POST',
      endpoint: BINANCE_ENDPOINTS.ORDER_CANCEL_REPLACE,
      params,
      signed: true,
      weight: BINANCE_REQUEST_WEIGHTS.CANCEL_REPLACE,
      isOrderEndpoint: true,
    });
    if (result.isErr()) return err(result.error);

    const newOrder = result.value.newOrderResponse;
    if (!newOrder || result.value.newOrderResult !== 'SUCCESS') {
      return err(UNSUPPORTED('modifyOrder failed — new order was not placed'));
    }

    return this.mapOrderWithSymbol(newOrder, request.symbol);
  }

  async submitBatch(
    _requests: SubmitOrderRequest[],
  ): Promise<Result<BatchOrderResult, ExchangeError>> {
    return err(UNSUPPORTED('submitBatch — not implemented in Milestone 5'));
  }

  async cancelBatch(
    _requests: CancelOrderRequest[],
  ): Promise<Result<BatchOrderResult, ExchangeError>> {
    return err(UNSUPPORTED('cancelBatch — not implemented in Milestone 5'));
  }

  // ── AccountProvider ───────────────────────────────────────────────────────

  async getBalance(): Promise<Result<Balance, ExchangeError>> {
    const result = await this.fetchAccount();
    if (result.isErr()) return err(result.error);
    return this.accountMapper.mapBalance(result.value, new Date());
  }

  async getAccountInfo(): Promise<Result<AccountInfo, ExchangeError>> {
    const result = await this.fetchAccount();
    if (result.isErr()) return err(result.error);
    return this.accountMapper.mapAccountInfo(result.value, new Date());
  }

  async getFeeRates(_symbol?: NormalizedSymbol): Promise<Result<FeeRates, ExchangeError>> {
    const result = await this.fetchAccount();
    if (result.isErr()) return err(result.error);
    return this.accountMapper.mapFeeRates(result.value, new Date());
  }

  async getTradingPermissions(): Promise<Result<TradingPermission[], ExchangeError>> {
    const result = await this.getAccountInfo();
    if (result.isErr()) return err(result.error);
    return ok(result.value.permissions);
  }

  // ── OrderProvider ─────────────────────────────────────────────────────────

  async getOpenOrders(symbol?: NormalizedSymbol): Promise<Result<Order[], ExchangeError>> {
    const params: Record<string, string | number | boolean> = {};
    const resolvedSymbol = symbol;

    if (symbol) {
      const symbolCheck = this.validateSymbol(symbol);
      if (symbolCheck.isErr()) return err(symbolCheck.error);

      const exchangeSymbolResult = this.symbolNormalizer.toExchangeSymbol(symbol, this.exchangeId);
      if (exchangeSymbolResult.isErr()) return err(exchangeSymbolResult.error);
      params.symbol = exchangeSymbolResult.value;
    }

    const weight = symbol
      ? BINANCE_REQUEST_WEIGHTS.OPEN_ORDERS_SINGLE
      : BINANCE_REQUEST_WEIGHTS.OPEN_ORDERS_ALL;

    const result = await this.restClient.execute<BinanceRawOrder[]>({
      method: 'GET',
      endpoint: BINANCE_ENDPOINTS.OPEN_ORDERS,
      params,
      signed: true,
      weight,
    });
    if (result.isErr()) return err(result.error);

    if (resolvedSymbol) {
      return this.mapOrdersWithSymbol(result.value, resolvedSymbol);
    }

    return this.mapOrdersMultiSymbol(result.value);
  }

  async getClosedOrders(
    symbol?: NormalizedSymbol,
    limit = 500,
  ): Promise<Result<Order[], ExchangeError>> {
    const query: OrderHistoryQuery = { symbol, limit };
    const allResult = await this.getOrderHistory(query);
    if (allResult.isErr()) return err(allResult.error);

    const closed = allResult.value.filter(
      (o) =>
        o.status === OrderStatus.FILLED ||
        o.status === OrderStatus.CANCELLED ||
        o.status === OrderStatus.EXPIRED ||
        o.status === OrderStatus.REJECTED,
    );
    return ok(closed);
  }

  async getOrderHistory(query: OrderHistoryQuery): Promise<Result<Order[], ExchangeError>> {
    if (!query.symbol) {
      return err(UNSUPPORTED('getOrderHistory without symbol — Binance requires a symbol'));
    }

    const symbolCheck = this.validateSymbol(query.symbol);
    if (symbolCheck.isErr()) return err(symbolCheck.error);

    const exchangeSymbolResult = this.symbolNormalizer.toExchangeSymbol(
      query.symbol,
      this.exchangeId,
    );
    if (exchangeSymbolResult.isErr()) return err(exchangeSymbolResult.error);

    const params: Record<string, string | number | boolean> = {
      symbol: exchangeSymbolResult.value,
    };
    if (query.startTime) params.startTime = query.startTime.getTime();
    if (query.endTime) params.endTime = query.endTime.getTime();
    if (query.limit) params.limit = Math.min(query.limit, 1000);

    const result = await this.restClient.execute<BinanceRawOrder[]>({
      method: 'GET',
      endpoint: BINANCE_ENDPOINTS.ALL_ORDERS,
      params,
      signed: true,
      weight: BINANCE_REQUEST_WEIGHTS.ALL_ORDERS,
    });
    if (result.isErr()) return err(result.error);

    return this.mapOrdersWithSymbol(result.value, query.symbol);
  }

  async getOrder(
    exchangeOrderId: string,
    symbol: NormalizedSymbol,
  ): Promise<Result<Order, ExchangeError>> {
    const symbolCheck = this.validateSymbol(symbol);
    if (symbolCheck.isErr()) return err(symbolCheck.error);

    const exchangeSymbolResult = this.symbolNormalizer.toExchangeSymbol(symbol, this.exchangeId);
    if (exchangeSymbolResult.isErr()) return err(exchangeSymbolResult.error);

    const result = await this.restClient.execute<BinanceRawOrder>({
      method: 'GET',
      endpoint: BINANCE_ENDPOINTS.ORDER,
      params: { symbol: exchangeSymbolResult.value, orderId: exchangeOrderId },
      signed: true,
      weight: BINANCE_REQUEST_WEIGHTS.ORDER_SINGLE,
    });
    if (result.isErr()) return err(result.error);

    return this.mapOrderWithSymbol(result.value, symbol);
  }

  async getOrderByClientId(
    clientOrderId: string,
    symbol: NormalizedSymbol,
  ): Promise<Result<Order, ExchangeError>> {
    const symbolCheck = this.validateSymbol(symbol);
    if (symbolCheck.isErr()) return err(symbolCheck.error);

    const exchangeSymbolResult = this.symbolNormalizer.toExchangeSymbol(symbol, this.exchangeId);
    if (exchangeSymbolResult.isErr()) return err(exchangeSymbolResult.error);

    const result = await this.restClient.execute<BinanceRawOrder>({
      method: 'GET',
      endpoint: BINANCE_ENDPOINTS.ORDER,
      params: {
        symbol: exchangeSymbolResult.value,
        origClientOrderId: clientOrderId,
      },
      signed: true,
      weight: BINANCE_REQUEST_WEIGHTS.ORDER_SINGLE,
    });
    if (result.isErr()) return err(result.error);

    return this.mapOrderWithSymbol(result.value, symbol);
  }

  // ── ExchangeMetadataProvider ──────────────────────────────────────────────

  async getExchangeInfo(): Promise<Result<ExchangeInfo, ExchangeError>> {
    const now = Date.now();
    if (this.cachedExchangeInfo && now - this.exchangeInfoFetchedAt < EXCHANGE_INFO_TTL_MS) {
      return ok(this.cachedExchangeInfo);
    }
    return this.fetchAndCacheExchangeInfo();
  }

  async getAllSymbols(): Promise<Result<SymbolInfo[], ExchangeError>> {
    const infoResult = await this.getExchangeInfo();
    if (infoResult.isErr()) return err(infoResult.error);
    return ok(infoResult.value.symbols);
  }

  getRateLimitStatus(): Result<RateLimitStatus[], ExchangeError> {
    return ok(this.rateLimitManager.getStatus());
  }

  isMaintenanceMode(): boolean {
    return this.cachedExchangeInfo?.isMaintenance ?? false;
  }

  // ── Funding Rate (not applicable to spot) ────────────────────────────────

  async getFundingRate(_symbol: NormalizedSymbol): Promise<Result<FundingRate, ExchangeError>> {
    return err(UNSUPPORTED('getFundingRate — Binance Spot does not have funding rates'));
  }

  // ── Position operations (not applicable to spot) ──────────────────────────

  async getOpenPositions(_symbol?: NormalizedSymbol): Promise<Result<Position[], ExchangeError>> {
    return ok([]);
  }

  async getPositionHistory(
    _symbol: NormalizedSymbol,
    _limit?: number,
  ): Promise<Result<Position[], ExchangeError>> {
    return err(UNSUPPORTED('getPositionHistory — not applicable to Binance Spot'));
  }

  async getPositionMode(): Promise<Result<PositionMode, ExchangeError>> {
    return err(UNSUPPORTED('getPositionMode — not applicable to Binance Spot'));
  }

  async setPositionMode(_mode: PositionMode): Promise<Result<void, ExchangeError>> {
    return err(UNSUPPORTED('setPositionMode — not applicable to Binance Spot'));
  }

  async getLeverage(_symbol: NormalizedSymbol): Promise<Result<number, ExchangeError>> {
    return err(UNSUPPORTED('getLeverage — not applicable to Binance Spot'));
  }

  async setLeverage(_request: SetLeverageRequest): Promise<Result<number, ExchangeError>> {
    return err(UNSUPPORTED('setLeverage — not applicable to Binance Spot'));
  }

  async getMarginMode(_symbol: NormalizedSymbol): Promise<Result<MarginMode, ExchangeError>> {
    return err(UNSUPPORTED('getMarginMode — not applicable to Binance Spot'));
  }

  async setMarginMode(_request: SetMarginModeRequest): Promise<Result<void, ExchangeError>> {
    return err(UNSUPPORTED('setMarginMode — not applicable to Binance Spot'));
  }

  async adjustMargin(_request: AdjustMarginRequest): Promise<Result<void, ExchangeError>> {
    return err(UNSUPPORTED('adjustMargin — not applicable to Binance Spot'));
  }

  // ── WebSocket subscriptions ───────────────────────────────────────────────

  async subscribeToTicker(
    symbol: NormalizedSymbol,
  ): Promise<Result<MarketDataSubscription, ExchangeError>> {
    const symbolCheck = this.validateSymbol(symbol);
    if (symbolCheck.isErr()) return err(symbolCheck.error);

    const exchangeSymbolResult = this.symbolNormalizer.toExchangeSymbol(symbol, this.exchangeId);
    if (exchangeSymbolResult.isErr()) return err(exchangeSymbolResult.error);

    const streamId = buildTickerStream(exchangeSymbolResult.value);
    return this.createWsSubscription(streamId, symbol, [MARKET_DATA_EVENTS.TICKER_UPDATED]);
  }

  async subscribeToOrderBook(
    symbol: NormalizedSymbol,
    _depth?: OrderBookDepth,
  ): Promise<Result<MarketDataSubscription, ExchangeError>> {
    const symbolCheck = this.validateSymbol(symbol);
    if (symbolCheck.isErr()) return err(symbolCheck.error);

    const exchangeSymbolResult = this.symbolNormalizer.toExchangeSymbol(symbol, this.exchangeId);
    if (exchangeSymbolResult.isErr()) return err(exchangeSymbolResult.error);

    // Diff depth stream provides incremental updates; pair with REST snapshot to seed local book
    const streamId = buildDiffDepthStream(exchangeSymbolResult.value);
    return this.createWsSubscription(streamId, symbol, [MARKET_DATA_EVENTS.ORDER_BOOK_UPDATED]);
  }

  async subscribeToTrades(
    symbol: NormalizedSymbol,
  ): Promise<Result<MarketDataSubscription, ExchangeError>> {
    const symbolCheck = this.validateSymbol(symbol);
    if (symbolCheck.isErr()) return err(symbolCheck.error);

    const exchangeSymbolResult = this.symbolNormalizer.toExchangeSymbol(symbol, this.exchangeId);
    if (exchangeSymbolResult.isErr()) return err(exchangeSymbolResult.error);

    const streamId = buildTradeStream(exchangeSymbolResult.value);
    return this.createWsSubscription(streamId, symbol, [MARKET_DATA_EVENTS.TRADE_EXECUTED]);
  }

  async subscribeToFundingRate(
    _symbol: NormalizedSymbol,
  ): Promise<Result<MarketDataSubscription, ExchangeError>> {
    return err(UNSUPPORTED('subscribeToFundingRate — Binance Spot does not have funding rates'));
  }

  async subscribeToMarkPrice(
    _symbol: NormalizedSymbol,
  ): Promise<Result<MarketDataSubscription, ExchangeError>> {
    return err(UNSUPPORTED('subscribeToMarkPrice — not applicable to Binance Spot'));
  }

  async unsubscribeAll(): Promise<void> {
    this.wsStreamManager.unsubscribeAll();
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async syncServerTime(): Promise<void> {
    const start = Date.now();
    const result = await this.restClient.execute<BinanceRawServerTime>({
      method: 'GET',
      endpoint: BINANCE_ENDPOINTS.SERVER_TIME,
      params: {},
      signed: false,
      weight: BINANCE_REQUEST_WEIGHTS.SERVER_TIME,
    });
    if (result.isErr()) throw result.error;

    const roundTripMs = Date.now() - start;
    this.serverTimeService.updateOffset(new Date(result.value.serverTime), roundTripMs);
  }

  private async fetchAndCacheExchangeInfo(): Promise<Result<ExchangeInfo, ExchangeError>> {
    const result = await this.restClient.execute<BinanceRawExchangeInfo>({
      method: 'GET',
      endpoint: BINANCE_ENDPOINTS.EXCHANGE_INFO,
      params: {},
      signed: false,
      weight: BINANCE_REQUEST_WEIGHTS.EXCHANGE_INFO,
    });
    if (result.isErr()) return err(result.error);

    const mapped = this.exchangeInfoMapper.map(result.value);
    if (mapped.isErr()) return err(mapped.error);

    this.cachedExchangeInfo = mapped.value;
    this.exchangeInfoFetchedAt = Date.now();

    // Seed the SymbolNormalizer with all spot symbols
    for (const symbolInfo of mapped.value.symbols) {
      this.symbolNormalizer.addMapping({
        exchangeId: this.exchangeId,
        exchangeSymbol: symbolInfo.exchangeSymbol,
        normalizedSymbol: symbolInfo.symbol,
      });
    }

    return ok(mapped.value);
  }

  private async fetchAccount(): Promise<Result<BinanceRawAccount, ExchangeError>> {
    return this.restClient.execute<BinanceRawAccount>({
      method: 'GET',
      endpoint: BINANCE_ENDPOINTS.ACCOUNT,
      params: {},
      signed: true,
      weight: BINANCE_REQUEST_WEIGHTS.ACCOUNT,
    });
  }

  private mapOrderWithSymbol(
    raw: BinanceRawOrder,
    symbol: NormalizedSymbol,
  ): Result<Order, ExchangeError> {
    const resolvedResult = this.symbolNormalizer.normalize(raw.symbol, this.exchangeId);
    const resolvedSymbol = resolvedResult.isOk() ? resolvedResult.value : symbol;

    const tempRaw = { ...raw };
    const receivedAt = new Date();
    const result = this.orderMapper.map(tempRaw, receivedAt);
    if (result.isErr()) return err(result.error);

    return ok({ ...result.value, symbol: resolvedSymbol });
  }

  private mapOrdersWithSymbol(
    rawOrders: BinanceRawOrder[],
    symbol: NormalizedSymbol,
  ): Result<Order[], ExchangeError> {
    const orders: Order[] = [];
    for (const raw of rawOrders) {
      const result = this.mapOrderWithSymbol(raw, symbol);
      if (result.isErr()) return err(result.error);
      orders.push(result.value);
    }
    return ok(orders);
  }

  private mapOrdersMultiSymbol(rawOrders: BinanceRawOrder[]): Result<Order[], ExchangeError> {
    const orders: Order[] = [];
    const receivedAt = new Date(); // used below in orderMapper.map(raw, receivedAt)
    for (const raw of rawOrders) {
      const normalizedResult = this.symbolNormalizer.normalize(raw.symbol, this.exchangeId);
      const symbol = normalizedResult.isOk()
        ? normalizedResult.value
        : NormalizedSymbol.unsafe(raw.symbol);

      const result = this.orderMapper.map(raw, receivedAt);
      if (result.isErr()) return err(result.error);
      orders.push({ ...result.value, symbol });
    }
    return ok(orders);
  }

  private toExchangeOrderType(request: SubmitOrderRequest): string {
    if (request.postOnly) return 'LIMIT_MAKER';
    const map: Record<string, string> = {
      MARKET: 'MARKET',
      LIMIT: 'LIMIT',
      STOP: 'STOP_LOSS_LIMIT',
      STOP_LIMIT: 'STOP_LOSS_LIMIT',
      TAKE_PROFIT: 'TAKE_PROFIT',
      TAKE_PROFIT_LIMIT: 'TAKE_PROFIT_LIMIT',
      TRAILING_STOP: 'TRAILING_STOP_MARKET',
    };
    return map[request.type] ?? 'LIMIT';
  }

  private createWsSubscription(
    streamId: string,
    symbol: NormalizedSymbol,
    eventTypes: readonly string[],
  ): Result<MarketDataSubscription, ExchangeError> {
    // noop handler — the MarketDataEventBus is the primary consumer channel
    const handler = (): void => {};
    const subscriptionId = this.wsStreamManager.subscribe(streamId, handler);

    if (subscriptionId === null) {
      return err(UNSUPPORTED(`WebSocket stream limit reached — cannot subscribe to ${streamId}`));
    }

    return ok({
      subscriptionId,
      symbol,
      exchangeId: this.exchangeId,
      eventTypes,
      unsubscribe: async () => {
        this.wsStreamManager.unsubscribe(streamId, handler);
      },
    });
  }

  private toExchangeTimeInForce(request: SubmitOrderRequest): string {
    if (request.type === 'MARKET') return 'GTC';
    const map: Record<string, string> = {
      GTC: 'GTC',
      IOC: 'IOC',
      FOK: 'FOK',
      POST_ONLY: 'GTC',
    };
    return map[request.timeInForce ?? 'GTC'] ?? 'GTC';
  }
}
