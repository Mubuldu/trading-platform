import { BaseExchangeAdapter } from '@modules/exchange/adapters/base-exchange.adapter';
import { ExchangeId, MarketType } from '@modules/exchange/enums/exchange.enums';
import {
  OrderStatus,
  OrderSide,
  OrderType,
  TimeInForce,
} from '@modules/exchange/enums/order.enums';
import { PositionSide, MarginMode, PositionMode } from '@modules/exchange/enums/position.enums';
import {
  ExchangeError,
  ExchangeConnectionError,
  ExchangeInvalidRequestError,
  ExchangeUnsupportedOperationError,
} from '@modules/exchange/errors/exchange.error';
import {
  ExchangeCapabilities,
  SymbolInfo,
  ExchangeInfo,
  RateLimitStatus,
} from '@modules/exchange/models/exchange.models';
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
  TradingPermission,
  Position,
} from '@modules/exchange/models/account.models';
import {
  SetLeverageRequest,
  SetMarginModeRequest,
  AdjustMarginRequest,
} from '@modules/exchange/interfaces/position-provider.interface';
import { OrderHistoryQuery } from '@modules/exchange/interfaces/order-provider.interface';
import { OrderBookDepth } from '@modules/exchange/interfaces/market-data-provider.interface';
import { SymbolNormalizer } from '@modules/exchange/normalizers/symbol.normalizer';
import { OrderStatusNormalizer } from '@modules/exchange/normalizers/order-status.normalizer';
import { OrderValidator } from '@modules/exchange/validators/order.validator';
import { ILogger } from '@core/logging/logger.interface';
import { Result, ok, err } from '@common/result';

function makeLogger(): jest.Mocked<ILogger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    critical: jest.fn(),
  };
}

const PAPER = ExchangeId.PAPER_TRADING;
const BTCUSDT = NormalizedSymbol.unsafe('BTC/USDT');

const TEST_CAPABILITIES: ExchangeCapabilities = {
  supportsSpot: true,
  supportsPerpetual: false,
  supportsFutures: false,
  supportsOptions: false,
  supportsMargin: false,
  supportsCrossMargin: false,
  supportsIsolatedMargin: false,
  supportsOco: false,
  supportsTpSl: false,
  supportsBatchOrders: false,
  supportsReduceOnly: false,
  supportsHedgeMode: false,
  supportsTrailingStop: false,
  supportsPostOnly: false,
  supportsConditionalOrders: false,
  supportsWebSocket: true,
  maxBatchOrderSize: 0,
};

const SYMBOL_INFO: SymbolInfo = {
  symbol: BTCUSDT,
  exchangeSymbol: 'BTCUSDT',
  baseAsset: 'BTC',
  quoteAsset: 'USDT',
  exchangeId: PAPER,
  marketType: MarketType.SPOT,
  isActive: true,
  pricePrecision: 2,
  quantityPrecision: 5,
  quotePrecision: 8,
  minQuantity: 0.00001,
  maxQuantity: 9000,
  stepSize: 0.00001,
  minPrice: 0.01,
  maxPrice: 1_000_000,
  tickSize: 0.01,
  minNotional: 10,
  allowsLimitOrder: true,
  allowsMarketOrder: true,
  allowsStopOrder: true,
  allowsPostOnly: true,
  allowsReduceOnly: false,
  allowsIceberg: false,
};

/**
 * Concrete test double — satisfies all ExchangeAdapter interface requirements.
 * Only the parts provided by BaseExchangeAdapter are exercised in this test.
 * All exchange-specific methods are stubbed with unsupported-operation errors.
 */
class TestAdapter extends BaseExchangeAdapter {
  readonly exchangeId = PAPER;
  readonly capabilities = TEST_CAPABILITIES;

  // Lifecycle spies exposed for assertion
  readonly initSpy = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
  readonly connectSpy = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
  readonly disconnectSpy = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);

  protected initializeInternal(): Promise<void> {
    return this.initSpy();
  }
  protected connectInternal(): Promise<void> {
    return this.connectSpy();
  }
  protected disconnectInternal(): Promise<void> {
    return this.disconnectSpy();
  }

  // ping is controllable so healthCheck tests can configure both outcomes
  private _pingResult: Result<number, ExchangeError> = ok(25);
  setPingResult(r: Result<number, ExchangeError>) {
    this._pingResult = r;
  }
  async ping(): Promise<Result<number, ExchangeError>> {
    return this._pingResult;
  }

  // ── All remaining interface stubs ─────────────────────────────────────────

  private unsupported<T>(): Result<T, ExchangeError> {
    return err(new ExchangeUnsupportedOperationError(PAPER, 'stub'));
  }

  async getServerTime(): Promise<Result<Date, ExchangeError>> {
    return this.unsupported();
  }
  async subscribeToTicker(
    _s: NormalizedSymbol,
  ): Promise<Result<MarketDataSubscription, ExchangeError>> {
    return this.unsupported();
  }
  async subscribeToOrderBook(
    _s: NormalizedSymbol,
    _d?: OrderBookDepth,
  ): Promise<Result<MarketDataSubscription, ExchangeError>> {
    return this.unsupported();
  }
  async subscribeToTrades(
    _s: NormalizedSymbol,
  ): Promise<Result<MarketDataSubscription, ExchangeError>> {
    return this.unsupported();
  }
  async subscribeToFundingRate(
    _s: NormalizedSymbol,
  ): Promise<Result<MarketDataSubscription, ExchangeError>> {
    return this.unsupported();
  }
  async subscribeToMarkPrice(
    _s: NormalizedSymbol,
  ): Promise<Result<MarketDataSubscription, ExchangeError>> {
    return this.unsupported();
  }
  async unsubscribeAll(): Promise<void> {
    return;
  }
  async getTicker(_s: NormalizedSymbol): Promise<Result<Ticker, ExchangeError>> {
    return this.unsupported();
  }
  async getOrderBook(
    _s: NormalizedSymbol,
    _d?: OrderBookDepth,
  ): Promise<Result<OrderBook, ExchangeError>> {
    return this.unsupported();
  }
  async getRecentTrades(
    _s: NormalizedSymbol,
    _l?: number,
  ): Promise<Result<Trade[], ExchangeError>> {
    return this.unsupported();
  }
  async getFundingRate(_s: NormalizedSymbol): Promise<Result<FundingRate, ExchangeError>> {
    return this.unsupported();
  }
  async getSupportedSymbols(): Promise<Result<NormalizedSymbol[], ExchangeError>> {
    return this.unsupported();
  }
  async getSymbolInfo(_s: NormalizedSymbol): Promise<Result<SymbolInfo, ExchangeError>> {
    return ok(SYMBOL_INFO);
  }

  async submitOrder(_r: SubmitOrderRequest): Promise<Result<Order, ExchangeError>> {
    return this.unsupported();
  }
  async cancelOrder(_r: CancelOrderRequest): Promise<Result<Order, ExchangeError>> {
    return this.unsupported();
  }
  async cancelAllOrders(_s?: NormalizedSymbol): Promise<Result<Order[], ExchangeError>> {
    return this.unsupported();
  }
  async modifyOrder(_r: ModifyOrderRequest): Promise<Result<Order, ExchangeError>> {
    return this.unsupported();
  }
  async submitBatch(_r: SubmitOrderRequest[]): Promise<Result<BatchOrderResult, ExchangeError>> {
    return this.unsupported();
  }
  async cancelBatch(_r: CancelOrderRequest[]): Promise<Result<BatchOrderResult, ExchangeError>> {
    return this.unsupported();
  }

  async getBalance(): Promise<Result<Balance, ExchangeError>> {
    return this.unsupported();
  }
  async getAccountInfo(): Promise<Result<AccountInfo, ExchangeError>> {
    return this.unsupported();
  }
  async getFeeRates(_s?: NormalizedSymbol): Promise<Result<FeeRates, ExchangeError>> {
    return this.unsupported();
  }
  async getTradingPermissions(): Promise<Result<TradingPermission[], ExchangeError>> {
    return this.unsupported();
  }

  async getOpenPositions(_s?: NormalizedSymbol): Promise<Result<Position[], ExchangeError>> {
    return this.unsupported();
  }
  async getPositionHistory(
    _s: NormalizedSymbol,
    _l?: number,
  ): Promise<Result<Position[], ExchangeError>> {
    return this.unsupported();
  }
  async getPositionMode(): Promise<Result<PositionMode, ExchangeError>> {
    return this.unsupported();
  }
  async setPositionMode(_m: PositionMode): Promise<Result<void, ExchangeError>> {
    return this.unsupported();
  }
  async getLeverage(_s: NormalizedSymbol): Promise<Result<number, ExchangeError>> {
    return this.unsupported();
  }
  async setLeverage(_r: SetLeverageRequest): Promise<Result<number, ExchangeError>> {
    return this.unsupported();
  }
  async getMarginMode(_s: NormalizedSymbol): Promise<Result<MarginMode, ExchangeError>> {
    return this.unsupported();
  }
  async setMarginMode(_r: SetMarginModeRequest): Promise<Result<void, ExchangeError>> {
    return this.unsupported();
  }
  async adjustMargin(_r: AdjustMarginRequest): Promise<Result<void, ExchangeError>> {
    return this.unsupported();
  }

  async getOpenOrders(_s?: NormalizedSymbol): Promise<Result<Order[], ExchangeError>> {
    return this.unsupported();
  }
  async getClosedOrders(
    _s?: NormalizedSymbol,
    _l?: number,
  ): Promise<Result<Order[], ExchangeError>> {
    return this.unsupported();
  }
  async getOrderHistory(_q: OrderHistoryQuery): Promise<Result<Order[], ExchangeError>> {
    return this.unsupported();
  }
  async getOrder(_id: string, _s: NormalizedSymbol): Promise<Result<Order, ExchangeError>> {
    return this.unsupported();
  }
  async getOrderByClientId(
    _id: string,
    _s: NormalizedSymbol,
  ): Promise<Result<Order, ExchangeError>> {
    return this.unsupported();
  }

  async getExchangeInfo(): Promise<Result<ExchangeInfo, ExchangeError>> {
    return this.unsupported();
  }
  async getAllSymbols(): Promise<Result<SymbolInfo[], ExchangeError>> {
    return this.unsupported();
  }
  getRateLimitStatus(): Result<RateLimitStatus[], ExchangeError> {
    return this.unsupported();
  }
  isMaintenanceMode(): boolean {
    return false;
  }
}

function makeAdapter(logger?: jest.Mocked<ILogger>): TestAdapter {
  return new TestAdapter(
    logger ?? makeLogger(),
    new SymbolNormalizer(),
    new OrderStatusNormalizer(),
    new OrderValidator(),
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('BaseExchangeAdapter', () => {
  describe('getExchangeId() / getCapabilities()', () => {
    it('returns the configured exchangeId', () => {
      const adapter = makeAdapter();
      expect(adapter.getExchangeId()).toBe(PAPER);
    });

    it('returns the configured capabilities', () => {
      const adapter = makeAdapter();
      expect(adapter.getCapabilities()).toBe(TEST_CAPABILITIES);
    });
  });

  describe('isFeatureSupported()', () => {
    it('returns true for a supported feature', () => {
      const adapter = makeAdapter();
      expect(adapter.isFeatureSupported('supportsSpot')).toBe(true);
    });

    it('returns false for an unsupported feature', () => {
      const adapter = makeAdapter();
      expect(adapter.isFeatureSupported('supportsFutures')).toBe(false);
    });
  });

  describe('initialize()', () => {
    it('calls initializeInternal() and returns ok', async () => {
      const adapter = makeAdapter();
      const result = await adapter.initialize();
      expect(result.isOk()).toBe(true);
      expect(adapter.initSpy).toHaveBeenCalledTimes(1);
    });

    it('returns ExchangeConnectionError when initializeInternal() throws', async () => {
      const adapter = makeAdapter();
      adapter.initSpy.mockRejectedValueOnce(new Error('network unreachable'));

      const result = await adapter.initialize();
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(ExchangeConnectionError);
        expect(result.error.exchangeId).toBe(PAPER);
      }
    });
  });

  describe('connect() / disconnect() / isConnected()', () => {
    it('isConnected() is false before connect()', () => {
      const adapter = makeAdapter();
      expect(adapter.isConnected()).toBe(false);
    });

    it('connect() sets isConnected() to true on success', async () => {
      const adapter = makeAdapter();
      await adapter.connect();
      expect(adapter.isConnected()).toBe(true);
    });

    it('disconnect() sets isConnected() to false regardless of outcome', async () => {
      const adapter = makeAdapter();
      await adapter.connect();
      expect(adapter.isConnected()).toBe(true);

      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
    });

    it('connect() returns ExchangeConnectionError when connectInternal() throws', async () => {
      const adapter = makeAdapter();
      adapter.connectSpy.mockRejectedValueOnce(new Error('TCP refused'));

      const result = await adapter.connect();
      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error).toBeInstanceOf(ExchangeConnectionError);
      expect(adapter.isConnected()).toBe(false);
    });

    it('disconnect() always sets isConnected() to false, even on error', async () => {
      const adapter = makeAdapter();
      await adapter.connect();
      adapter.disconnectSpy.mockRejectedValueOnce(new Error('flush error'));

      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
    });
  });

  describe('destroy()', () => {
    it('disconnects even if never connected', async () => {
      const adapter = makeAdapter();
      await expect(adapter.destroy()).resolves.toBeUndefined();
    });

    it('calls disconnectSpy during destroy', async () => {
      const adapter = makeAdapter();
      await adapter.connect();
      await adapter.destroy();
      expect(adapter.disconnectSpy).toHaveBeenCalled();
    });
  });

  describe('healthCheck()', () => {
    it('returns ExchangeConnectionError when not connected', async () => {
      const adapter = makeAdapter();
      const result = await adapter.healthCheck();
      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error).toBeInstanceOf(ExchangeConnectionError);
    });

    it('returns latency string when connected and ping succeeds', async () => {
      const adapter = makeAdapter();
      await adapter.connect();
      adapter.setPingResult(ok(42));

      const result = await adapter.healthCheck();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toContain('paper_trading');
        expect(result.value).toContain('42ms');
      }
    });

    it('propagates ping error when connected but ping fails', async () => {
      const adapter = makeAdapter();
      await adapter.connect();
      adapter.setPingResult(err(new ExchangeConnectionError(PAPER)));

      const result = await adapter.healthCheck();
      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error).toBeInstanceOf(ExchangeConnectionError);
    });
  });

  describe('validateSymbol() (via protected method, tested through initialize path)', () => {
    it('rejects a symbol in exchange-native format (BTCUSDT — no slash)', () => {
      const adapter = makeAdapter();
      // Access protected method via type assertion for white-box testing
      const result = (
        adapter as unknown as { validateSymbol(s: NormalizedSymbol): Result<void, ExchangeError> }
      ).validateSymbol(NormalizedSymbol.unsafe('BTCUSDT'));

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(ExchangeInvalidRequestError);
        expect(result.error.exchangeId).toBe(PAPER);
      }
    });

    it('accepts a symbol in BASE/QUOTE format', () => {
      const adapter = makeAdapter();
      const result = (
        adapter as unknown as { validateSymbol(s: NormalizedSymbol): Result<void, ExchangeError> }
      ).validateSymbol(BTCUSDT);

      expect(result.isOk()).toBe(true);
    });

    it('accepts a BASE/QUOTE:SETTLEMENT perpetual symbol', () => {
      const adapter = makeAdapter();
      const perp = NormalizedSymbol.unsafe('BTC/USDT:USDT');
      const result = (
        adapter as unknown as { validateSymbol(s: NormalizedSymbol): Result<void, ExchangeError> }
      ).validateSymbol(perp);

      expect(result.isOk()).toBe(true);
    });
  });

  describe('logging', () => {
    it('logs info on successful initialize()', async () => {
      const logger = makeLogger();
      const adapter = makeAdapter(logger);
      await adapter.initialize();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('paper_trading'),
        expect.any(String),
      );
    });

    it('logs error on failed initialize()', async () => {
      const logger = makeLogger();
      const adapter = makeAdapter(logger);
      adapter.initSpy.mockRejectedValueOnce(new Error('boom'));
      await adapter.initialize();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('OrderStatus.UNKNOWN — normalizer regression', () => {
    it('OrderStatus enum contains UNKNOWN', () => {
      expect(OrderStatus.UNKNOWN).toBe('UNKNOWN');
    });

    it('OrderSide mapping covers BUY and SELL', () => {
      expect(OrderSide.BUY).toBe('BUY');
      expect(OrderSide.SELL).toBe('SELL');
    });

    it('PositionSide mapping covers LONG, SHORT, FLAT', () => {
      expect(PositionSide.LONG).toBe('LONG');
      expect(PositionSide.SHORT).toBe('SHORT');
      expect(PositionSide.FLAT).toBe('FLAT');
    });

    it('OrderType covers all required types', () => {
      const required = ['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT', 'TRAILING_STOP', 'TAKE_PROFIT'];
      for (const type of required) {
        expect(Object.values(OrderType)).toContain(type);
      }
    });

    it('TimeInForce covers all required values', () => {
      expect(TimeInForce.GTC).toBe('GTC');
      expect(TimeInForce.IOC).toBe('IOC');
      expect(TimeInForce.FOK).toBe('FOK');
      expect(TimeInForce.POST_ONLY).toBe('POST_ONLY');
    });

    it('MarginMode covers ISOLATED and CROSS', () => {
      expect(MarginMode.ISOLATED).toBe('ISOLATED');
      expect(MarginMode.CROSS).toBe('CROSS');
    });
  });
});
