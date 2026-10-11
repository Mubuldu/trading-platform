import { ILogger } from '@core/logging/logger.interface';
import { Result, ok, err } from '@common/result';
import { NormalizedSymbol, MarketDataSubscription } from '../models/common.model';
import { ExchangeId } from '../enums/exchange.enums';
import { MarginMode, PositionMode } from '../enums/position.enums';
import {
  ExchangeCapabilities,
  SymbolInfo,
  ExchangeInfo,
  RateLimitStatus,
} from '../models/exchange.models';
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
import { ExchangeAdapter } from '../interfaces/exchange-adapter.interface';
import { OrderBookDepth } from '../interfaces/market-data-provider.interface';
import { OrderHistoryQuery } from '../interfaces/order-provider.interface';
import {
  SetLeverageRequest,
  SetMarginModeRequest,
  AdjustMarginRequest,
} from '../interfaces/position-provider.interface';
import {
  ExchangeError,
  ExchangeConnectionError,
  ExchangeInvalidRequestError,
} from '../errors/exchange.error';
import { SymbolNormalizer } from '../normalizers/symbol.normalizer';
import { OrderStatusNormalizer } from '../normalizers/order-status.normalizer';
import { OrderValidator } from '../validators/order.validator';

/**
 * BaseExchangeAdapter provides the scaffolding that all exchange adapters share.
 *
 * Concrete adapters extend this and implement the abstract methods. They must
 * NOT override the public interface methods — only the protected internal
 * methods. This ensures the cross-cutting concerns (logging, validation,
 * error normalization, rate limiting) are applied consistently across all
 * exchanges.
 *
 * Cross-cutting concerns provided by the base:
 *  - Structured logging with exchange context on every operation
 *  - Symbol validation before any request leaves the adapter
 *  - Order validation against current SymbolInfo before submission
 *  - Connection state tracking
 *  - Consistent error message formatting
 *
 * Abstract methods that concrete adapters implement:
 *  - connectInternal() / disconnectInternal() / initializeInternal()
 *  - All provider interface methods (subscribeToTicker, submitOrder, etc.)
 *
 * Rules for concrete adapters:
 *  1. Never import exchange SDKs outside the adapter's own directory
 *  2. Never expose raw exchange types — always map to normalized models
 *  3. Never throw — return Result or ExchangeError
 *  4. Never log raw exchange responses (rate limit, auth, order data)
 *  5. Always call super.validateSymbol() before any exchange request
 *  6. Always use this.symbolNormalizer to translate symbols in both directions
 */
export abstract class BaseExchangeAdapter implements ExchangeAdapter {
  abstract readonly exchangeId: ExchangeId;
  abstract readonly capabilities: ExchangeCapabilities;

  protected readonly context: string;
  protected isConnectionActive = false;

  constructor(
    protected readonly logger: ILogger,
    protected readonly symbolNormalizer: SymbolNormalizer,
    protected readonly orderStatusNormalizer: OrderStatusNormalizer,
    protected readonly orderValidator: OrderValidator,
  ) {
    this.context = this.constructor.name;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async initialize(): Promise<Result<void, ExchangeError>> {
    this.logger.info(`Initializing exchange adapter: ${this.exchangeId}`, this.context);
    try {
      await this.initializeInternal();
      this.logger.info(`Exchange adapter initialized: ${this.exchangeId}`, this.context);
      return ok(undefined);
    } catch (e) {
      const error = new ExchangeConnectionError(
        this.exchangeId,
        e instanceof Error ? e : undefined,
      );
      this.logger.error(
        `${this.exchangeId}: initialize failed — ${error.message}`,
        error.stack,
        this.context,
      );
      return err(error);
    }
  }

  async connect(): Promise<Result<void, ExchangeError>> {
    this.logger.info(`Connecting to ${this.exchangeId}`, this.context);
    try {
      await this.connectInternal();
      this.isConnectionActive = true;
      this.logger.info(`Connected to ${this.exchangeId}`, this.context);
      return ok(undefined);
    } catch (e) {
      const error = new ExchangeConnectionError(
        this.exchangeId,
        e instanceof Error ? e : undefined,
      );
      return err(error);
    }
  }

  async disconnect(): Promise<Result<void, ExchangeError>> {
    this.logger.info(`Disconnecting from ${this.exchangeId}`, this.context);
    try {
      await this.disconnectInternal();
    } catch {
      // always set inactive, even if the disconnect call fails
    }
    this.isConnectionActive = false;
    return ok(undefined);
  }

  async destroy(): Promise<void> {
    this.logger.info(`Destroying adapter for ${this.exchangeId}`, this.context);
    await this.disconnect().catch(() => {});
    await this.destroyInternal().catch(() => {});
  }

  isConnected(): boolean {
    return this.isConnectionActive;
  }

  // ── ExchangeCapabilityProvider ────────────────────────────────────────────

  isFeatureSupported(feature: keyof ExchangeCapabilities): boolean {
    return Boolean(this.capabilities[feature]);
  }

  getExchangeId(): ExchangeId {
    return this.exchangeId;
  }

  getCapabilities(): ExchangeCapabilities {
    return this.capabilities;
  }

  // ── Health ────────────────────────────────────────────────────────────────

  async healthCheck(): Promise<Result<string, ExchangeError>> {
    if (!this.isConnectionActive) {
      return err(new ExchangeConnectionError(this.exchangeId));
    }
    const latencyResult = await this.ping();
    if (latencyResult.isErr()) return err(latencyResult.error);
    return ok(`${this.exchangeId}: connected, latency ${latencyResult.value}ms`);
  }

  // ── Protected utilities ───────────────────────────────────────────────────

  protected validateSymbol(symbol: NormalizedSymbol): Result<void, ExchangeError> {
    if (!NormalizedSymbol.isValid(symbol)) {
      return err(
        new ExchangeInvalidRequestError(
          this.exchangeId,
          `"${symbol}" is not a valid normalized symbol (expected BASE/QUOTE format)`,
        ),
      );
    }
    return ok(undefined);
  }

  protected logOperation(operation: string, symbol?: NormalizedSymbol): void {
    const symbolPart = symbol ? ` [${symbol}]` : '';
    this.logger.debug(`${this.exchangeId}: ${operation}${symbolPart}`, this.context);
  }

  protected logError(operation: string, error: ExchangeError): void {
    this.logger.error(
      `${this.exchangeId}: ${operation} failed — ${error.message}`,
      error.stack,
      this.context,
    );
  }

  // ── Abstract internal lifecycle (implement in concrete adapters) ──────────

  protected abstract initializeInternal(): Promise<void>;
  protected abstract connectInternal(): Promise<void>;
  protected abstract disconnectInternal(): Promise<void>;
  protected destroyInternal(): Promise<void> {
    return Promise.resolve();
  }

  // ── Abstract interface methods (implement in concrete adapters) ───────────
  // MarketDataProvider
  abstract ping(): Promise<Result<number, ExchangeError>>;
  abstract getServerTime(): Promise<Result<Date, ExchangeError>>;
  abstract subscribeToTicker(
    symbol: NormalizedSymbol,
  ): Promise<Result<MarketDataSubscription, ExchangeError>>;
  abstract subscribeToOrderBook(
    symbol: NormalizedSymbol,
    depth?: OrderBookDepth,
  ): Promise<Result<MarketDataSubscription, ExchangeError>>;
  abstract subscribeToTrades(
    symbol: NormalizedSymbol,
  ): Promise<Result<MarketDataSubscription, ExchangeError>>;
  abstract subscribeToFundingRate(
    symbol: NormalizedSymbol,
  ): Promise<Result<MarketDataSubscription, ExchangeError>>;
  abstract subscribeToMarkPrice(
    symbol: NormalizedSymbol,
  ): Promise<Result<MarketDataSubscription, ExchangeError>>;
  abstract unsubscribeAll(): Promise<void>;
  abstract getTicker(symbol: NormalizedSymbol): Promise<Result<Ticker, ExchangeError>>;
  abstract getOrderBook(
    symbol: NormalizedSymbol,
    depth?: OrderBookDepth,
  ): Promise<Result<OrderBook, ExchangeError>>;
  abstract getRecentTrades(
    symbol: NormalizedSymbol,
    limit?: number,
  ): Promise<Result<Trade[], ExchangeError>>;
  abstract getFundingRate(symbol: NormalizedSymbol): Promise<Result<FundingRate, ExchangeError>>;
  abstract getSupportedSymbols(): Promise<Result<NormalizedSymbol[], ExchangeError>>;
  abstract getSymbolInfo(symbol: NormalizedSymbol): Promise<Result<SymbolInfo, ExchangeError>>;

  // TradingProvider
  abstract submitOrder(request: SubmitOrderRequest): Promise<Result<Order, ExchangeError>>;
  abstract cancelOrder(request: CancelOrderRequest): Promise<Result<Order, ExchangeError>>;
  abstract cancelAllOrders(symbol?: NormalizedSymbol): Promise<Result<Order[], ExchangeError>>;
  abstract modifyOrder(request: ModifyOrderRequest): Promise<Result<Order, ExchangeError>>;
  abstract submitBatch(
    requests: SubmitOrderRequest[],
  ): Promise<Result<BatchOrderResult, ExchangeError>>;
  abstract cancelBatch(
    requests: CancelOrderRequest[],
  ): Promise<Result<BatchOrderResult, ExchangeError>>;

  // AccountProvider
  abstract getBalance(): Promise<Result<Balance, ExchangeError>>;
  abstract getAccountInfo(): Promise<Result<AccountInfo, ExchangeError>>;
  abstract getFeeRates(symbol?: NormalizedSymbol): Promise<Result<FeeRates, ExchangeError>>;
  abstract getTradingPermissions(): Promise<Result<TradingPermission[], ExchangeError>>;

  // PositionProvider
  abstract getOpenPositions(symbol?: NormalizedSymbol): Promise<Result<Position[], ExchangeError>>;
  abstract getPositionHistory(
    symbol: NormalizedSymbol,
    limit?: number,
  ): Promise<Result<Position[], ExchangeError>>;
  abstract getPositionMode(): Promise<Result<PositionMode, ExchangeError>>;
  abstract setPositionMode(mode: PositionMode): Promise<Result<void, ExchangeError>>;
  abstract getLeverage(symbol: NormalizedSymbol): Promise<Result<number, ExchangeError>>;
  abstract setLeverage(request: SetLeverageRequest): Promise<Result<number, ExchangeError>>;
  abstract getMarginMode(symbol: NormalizedSymbol): Promise<Result<MarginMode, ExchangeError>>;
  abstract setMarginMode(request: SetMarginModeRequest): Promise<Result<void, ExchangeError>>;
  abstract adjustMargin(request: AdjustMarginRequest): Promise<Result<void, ExchangeError>>;

  // OrderProvider
  abstract getOpenOrders(symbol?: NormalizedSymbol): Promise<Result<Order[], ExchangeError>>;
  abstract getClosedOrders(
    symbol?: NormalizedSymbol,
    limit?: number,
  ): Promise<Result<Order[], ExchangeError>>;
  abstract getOrderHistory(query: OrderHistoryQuery): Promise<Result<Order[], ExchangeError>>;
  abstract getOrder(
    exchangeOrderId: string,
    symbol: NormalizedSymbol,
  ): Promise<Result<Order, ExchangeError>>;
  abstract getOrderByClientId(
    clientOrderId: string,
    symbol: NormalizedSymbol,
  ): Promise<Result<Order, ExchangeError>>;

  // ExchangeMetadataProvider
  abstract getExchangeInfo(): Promise<Result<ExchangeInfo, ExchangeError>>;
  abstract getAllSymbols(): Promise<Result<SymbolInfo[], ExchangeError>>;
  abstract getRateLimitStatus(): Result<RateLimitStatus[], ExchangeError>;
  abstract isMaintenanceMode(): boolean;
}
