import { ILogger } from '@core/logging/logger.interface';
import { Result, ok, err } from '@common/result';
import { NormalizedSymbol, MarketDataSubscription } from '../models/common.model';
import { MarginMode, PositionMode } from '../enums/position.enums';
import { SymbolInfo, ExchangeInfo, RateLimitStatus } from '../models/exchange.models';
import { Ticker, OrderBook, Trade, FundingRate } from '../models/market.models';
import {
  Order,
  SubmitOrderRequest,
  CancelOrderRequest,
  ModifyOrderRequest,
  BatchOrderResult,
} from '../models/trading.models';
import {
  Balance,
  AccountInfo,
  FeeRates,
  TradingPermission,
  Position,
} from '../models/account.models';
import { OrderBookDepth } from '../interfaces/market-data-provider.interface';
import { OrderHistoryQuery } from '../interfaces/order-provider.interface';
import {
  SetLeverageRequest,
  SetMarginModeRequest,
  AdjustMarginRequest,
} from '../interfaces/position-provider.interface';
import { BaseExchangeAdapter } from './base-exchange.adapter';
import { SymbolNormalizer } from '../normalizers/symbol.normalizer';
import { OrderStatusNormalizer } from '../normalizers/order-status.normalizer';
import { OrderValidator } from '../validators/order.validator';
import { ExchangeError, ExchangeUnsupportedOperationError } from '../errors/exchange.error';

/**
 * StubExchangeAdapter is the structural skeleton for exchanges that are
 * registered but not yet fully implemented.
 *
 * Every abstract method from BaseExchangeAdapter returns
 * ExchangeUnsupportedOperationError with a "not yet implemented" message.
 * This means:
 *  - The type system is satisfied (no abstract class violations).
 *  - At runtime, callers receive a clear, typed error — no silent failures.
 *  - Integration tests that assert on ExchangeUnsupportedOperationError will
 *    correctly flag stubs as incomplete.
 *
 * Lifecycle: initializeInternal(), connectInternal(), disconnectInternal()
 * are no-ops. The adapter does nothing on startup and nothing on teardown.
 *
 * How to graduate a stub to a real adapter:
 *  1. Override initializeInternal() to fetch ExchangeInfo and seed SymbolNormalizer.
 *  2. Override connectInternal() to establish WebSocket connections.
 *  3. Override each method group (market data, trading, account, etc.) one at a time.
 *  4. Remove the super call from each overridden method.
 *  5. Delete this comment once all methods are implemented.
 *
 * Concrete stubs extend this class and set exchangeId + capabilities.
 * They should NOT override any methods until they are ready to implement them.
 */
export abstract class StubExchangeAdapter extends BaseExchangeAdapter {
  constructor(
    logger: ILogger,
    symbolNormalizer: SymbolNormalizer,
    orderStatusNormalizer: OrderStatusNormalizer,
    orderValidator: OrderValidator,
  ) {
    super(logger, symbolNormalizer, orderStatusNormalizer, orderValidator);
  }

  // ── Lifecycle (no-ops for stubs) ──────────────────────────────────────────

  protected async initializeInternal(): Promise<void> {
    this.logger.debug(`${this.exchangeId}: stub adapter — no initialization`, this.context);
  }

  protected async connectInternal(): Promise<void> {
    this.logger.debug(`${this.exchangeId}: stub adapter — no WebSocket connection`, this.context);
  }

  protected async disconnectInternal(): Promise<void> {
    this.logger.debug(
      `${this.exchangeId}: stub adapter — no WebSocket to disconnect`,
      this.context,
    );
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Returns a typed error for every unimplemented method. */
  protected notImplemented(method: string): ExchangeUnsupportedOperationError {
    return new ExchangeUnsupportedOperationError(
      this.exchangeId,
      `${method} — adapter for "${this.exchangeId}" is not yet implemented`,
    );
  }

  // ── MarketDataProvider ────────────────────────────────────────────────────

  async ping(): Promise<Result<number, ExchangeError>> {
    return err(this.notImplemented('ping'));
  }

  async getServerTime(): Promise<Result<Date, ExchangeError>> {
    return err(this.notImplemented('getServerTime'));
  }

  async getTicker(_symbol: NormalizedSymbol): Promise<Result<Ticker, ExchangeError>> {
    return err(this.notImplemented('getTicker'));
  }

  async getOrderBook(
    _symbol: NormalizedSymbol,
    _depth?: OrderBookDepth,
  ): Promise<Result<OrderBook, ExchangeError>> {
    return err(this.notImplemented('getOrderBook'));
  }

  async getRecentTrades(
    _symbol: NormalizedSymbol,
    _limit?: number,
  ): Promise<Result<Trade[], ExchangeError>> {
    return err(this.notImplemented('getRecentTrades'));
  }

  async getFundingRate(_symbol: NormalizedSymbol): Promise<Result<FundingRate, ExchangeError>> {
    return err(this.notImplemented('getFundingRate'));
  }

  async getSupportedSymbols(): Promise<Result<NormalizedSymbol[], ExchangeError>> {
    return err(this.notImplemented('getSupportedSymbols'));
  }

  async getSymbolInfo(_symbol: NormalizedSymbol): Promise<Result<SymbolInfo, ExchangeError>> {
    return err(this.notImplemented('getSymbolInfo'));
  }

  async subscribeToTicker(
    _symbol: NormalizedSymbol,
  ): Promise<Result<MarketDataSubscription, ExchangeError>> {
    return err(this.notImplemented('subscribeToTicker'));
  }

  async subscribeToOrderBook(
    _symbol: NormalizedSymbol,
    _depth?: OrderBookDepth,
  ): Promise<Result<MarketDataSubscription, ExchangeError>> {
    return err(this.notImplemented('subscribeToOrderBook'));
  }

  async subscribeToTrades(
    _symbol: NormalizedSymbol,
  ): Promise<Result<MarketDataSubscription, ExchangeError>> {
    return err(this.notImplemented('subscribeToTrades'));
  }

  async subscribeToFundingRate(
    _symbol: NormalizedSymbol,
  ): Promise<Result<MarketDataSubscription, ExchangeError>> {
    return err(this.notImplemented('subscribeToFundingRate'));
  }

  async subscribeToMarkPrice(
    _symbol: NormalizedSymbol,
  ): Promise<Result<MarketDataSubscription, ExchangeError>> {
    return err(this.notImplemented('subscribeToMarkPrice'));
  }

  async unsubscribeAll(): Promise<void> {
    // no-op: no subscriptions exist on a stub
  }

  // ── TradingProvider ───────────────────────────────────────────────────────

  async submitOrder(_request: SubmitOrderRequest): Promise<Result<Order, ExchangeError>> {
    return err(this.notImplemented('submitOrder'));
  }

  async cancelOrder(_request: CancelOrderRequest): Promise<Result<Order, ExchangeError>> {
    return err(this.notImplemented('cancelOrder'));
  }

  async cancelAllOrders(_symbol?: NormalizedSymbol): Promise<Result<Order[], ExchangeError>> {
    return err(this.notImplemented('cancelAllOrders'));
  }

  async modifyOrder(_request: ModifyOrderRequest): Promise<Result<Order, ExchangeError>> {
    return err(this.notImplemented('modifyOrder'));
  }

  async submitBatch(
    _requests: SubmitOrderRequest[],
  ): Promise<Result<BatchOrderResult, ExchangeError>> {
    return err(this.notImplemented('submitBatch'));
  }

  async cancelBatch(
    _requests: CancelOrderRequest[],
  ): Promise<Result<BatchOrderResult, ExchangeError>> {
    return err(this.notImplemented('cancelBatch'));
  }

  // ── AccountProvider ───────────────────────────────────────────────────────

  async getBalance(): Promise<Result<Balance, ExchangeError>> {
    return err(this.notImplemented('getBalance'));
  }

  async getAccountInfo(): Promise<Result<AccountInfo, ExchangeError>> {
    return err(this.notImplemented('getAccountInfo'));
  }

  async getFeeRates(_symbol?: NormalizedSymbol): Promise<Result<FeeRates, ExchangeError>> {
    return err(this.notImplemented('getFeeRates'));
  }

  async getTradingPermissions(): Promise<Result<TradingPermission[], ExchangeError>> {
    return err(this.notImplemented('getTradingPermissions'));
  }

  // ── PositionProvider ──────────────────────────────────────────────────────

  async getOpenPositions(_symbol?: NormalizedSymbol): Promise<Result<Position[], ExchangeError>> {
    return err(this.notImplemented('getOpenPositions'));
  }

  async getPositionHistory(
    _symbol: NormalizedSymbol,
    _limit?: number,
  ): Promise<Result<Position[], ExchangeError>> {
    return err(this.notImplemented('getPositionHistory'));
  }

  async getPositionMode(): Promise<Result<PositionMode, ExchangeError>> {
    return err(this.notImplemented('getPositionMode'));
  }

  async setPositionMode(_mode: PositionMode): Promise<Result<void, ExchangeError>> {
    return err(this.notImplemented('setPositionMode'));
  }

  async getLeverage(_symbol: NormalizedSymbol): Promise<Result<number, ExchangeError>> {
    return err(this.notImplemented('getLeverage'));
  }

  async setLeverage(_request: SetLeverageRequest): Promise<Result<number, ExchangeError>> {
    return err(this.notImplemented('setLeverage'));
  }

  async getMarginMode(_symbol: NormalizedSymbol): Promise<Result<MarginMode, ExchangeError>> {
    return err(this.notImplemented('getMarginMode'));
  }

  async setMarginMode(_request: SetMarginModeRequest): Promise<Result<void, ExchangeError>> {
    return err(this.notImplemented('setMarginMode'));
  }

  async adjustMargin(_request: AdjustMarginRequest): Promise<Result<void, ExchangeError>> {
    return err(this.notImplemented('adjustMargin'));
  }

  // ── OrderProvider ─────────────────────────────────────────────────────────

  async getOpenOrders(_symbol?: NormalizedSymbol): Promise<Result<Order[], ExchangeError>> {
    return err(this.notImplemented('getOpenOrders'));
  }

  async getClosedOrders(
    _symbol?: NormalizedSymbol,
    _limit?: number,
  ): Promise<Result<Order[], ExchangeError>> {
    return err(this.notImplemented('getClosedOrders'));
  }

  async getOrderHistory(_query: OrderHistoryQuery): Promise<Result<Order[], ExchangeError>> {
    return err(this.notImplemented('getOrderHistory'));
  }

  async getOrder(
    _exchangeOrderId: string,
    _symbol: NormalizedSymbol,
  ): Promise<Result<Order, ExchangeError>> {
    return err(this.notImplemented('getOrder'));
  }

  async getOrderByClientId(
    _clientOrderId: string,
    _symbol: NormalizedSymbol,
  ): Promise<Result<Order, ExchangeError>> {
    return err(this.notImplemented('getOrderByClientId'));
  }

  // ── ExchangeMetadataProvider ──────────────────────────────────────────────

  async getExchangeInfo(): Promise<Result<ExchangeInfo, ExchangeError>> {
    return err(this.notImplemented('getExchangeInfo'));
  }

  async getAllSymbols(): Promise<Result<SymbolInfo[], ExchangeError>> {
    return err(this.notImplemented('getAllSymbols'));
  }

  getRateLimitStatus(): Result<RateLimitStatus[], ExchangeError> {
    return ok([]); // stubs have no rate limits tracked
  }

  isMaintenanceMode(): boolean {
    return false;
  }
}
