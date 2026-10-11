import { BinanceSpotAdapter } from '@modules/exchange/adapters/binance/binance-spot.adapter';
import { BinanceRestClient } from '@modules/exchange/adapters/binance/client/binance-rest.client';
import { BinanceServerTimeService } from '@modules/exchange/adapters/binance/server-time/binance-server-time.service';
import { BinanceRateLimitManager } from '@modules/exchange/adapters/binance/rate-limit/binance-rate-limit.manager';
import { BinanceExchangeInfoMapper } from '@modules/exchange/adapters/binance/mappers/binance-exchange-info.mapper';
import {
  BinanceOrderMapper,
  BINANCE_ORDER_STATUS_MAP,
} from '@modules/exchange/adapters/binance/mappers/binance-order.mapper';
import { BinanceTicker24hrMapper } from '@modules/exchange/adapters/binance/mappers/binance-ticker.mapper';
import { BinanceOrderBookMapper } from '@modules/exchange/adapters/binance/mappers/binance-order-book.mapper';
import { BinanceTradeMapper } from '@modules/exchange/adapters/binance/mappers/binance-trade.mapper';
import { BinanceAccountMapper } from '@modules/exchange/adapters/binance/mappers/binance-account.mapper';
import { SymbolNormalizer } from '@modules/exchange/normalizers/symbol.normalizer';
import { OrderStatusNormalizer } from '@modules/exchange/normalizers/order-status.normalizer';
import { OrderValidator } from '@modules/exchange/validators/order.validator';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { OrderSide, OrderType } from '@modules/exchange/enums/order.enums';
import { NormalizedSymbol } from '@modules/exchange/models/common.model';
import {
  ExchangeUnsupportedOperationError,
  ExchangeConnectionError,
} from '@modules/exchange/errors/exchange.error';
import { ILogger } from '@core/logging/logger.interface';
import { ok, err } from '@common/result';

const BTCUSDT = NormalizedSymbol.unsafe('BTC/USDT');

function makeLogger(): jest.Mocked<ILogger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    critical: jest.fn(),
  };
}

function makeRestClient(): jest.Mocked<Pick<BinanceRestClient, 'execute' | 'destroy'>> {
  return {
    execute: jest.fn(),
    destroy: jest.fn(),
  };
}

const MOCK_EXCHANGE_INFO = {
  timezone: 'UTC',
  serverTime: 1700000000000,
  rateLimits: [
    { rateLimitType: 'REQUEST_WEIGHT', interval: 'MINUTE', intervalNum: 1, limit: 6000 },
  ],
  symbols: [
    {
      symbol: 'BTCUSDT',
      status: 'TRADING',
      baseAsset: 'BTC',
      baseAssetPrecision: 8,
      quoteAsset: 'USDT',
      quoteAssetPrecision: 8,
      quotePrecision: 8,
      orderTypes: ['LIMIT', 'LIMIT_MAKER', 'MARKET', 'STOP_LOSS_LIMIT'],
      icebergAllowed: true,
      ocoAllowed: true,
      isSpotTradingAllowed: true,
      isMarginalTradingAllowed: false,
      filters: [
        { filterType: 'PRICE_FILTER', minPrice: '0.01', maxPrice: '1000000', tickSize: '0.01' },
        { filterType: 'LOT_SIZE', minQty: '0.00001', maxQty: '9000', stepSize: '0.00001' },
        { filterType: 'MIN_NOTIONAL', minNotional: '10' },
      ],
      permissions: ['SPOT'],
    },
  ],
};

const MOCK_ORDER = {
  symbol: 'BTCUSDT',
  orderId: 12345,
  orderListId: -1,
  clientOrderId: 'myOrder001',
  price: '50000.00',
  origQty: '0.001',
  executedQty: '0.000',
  cummulativeQuoteQty: '0.00',
  status: 'NEW',
  timeInForce: 'GTC',
  type: 'LIMIT',
  side: 'BUY',
  time: 1700000000000,
  updateTime: 1700000001000,
  isWorking: true,
  workingTime: 1700000000000,
  origQuoteOrderQty: '50.00',
};

function makeAdapter(restClient: ReturnType<typeof makeRestClient>): BinanceSpotAdapter {
  const logger = makeLogger();
  const symbolNormalizer = new SymbolNormalizer();
  const statusNormalizer = new OrderStatusNormalizer();
  statusNormalizer.registerMappings(ExchangeId.BINANCE_SPOT, BINANCE_ORDER_STATUS_MAP);
  const orderValidator = new OrderValidator();
  const serverTimeService = new BinanceServerTimeService();
  const rateLimitManager = new BinanceRateLimitManager();
  const exchangeInfoMapper = new BinanceExchangeInfoMapper();
  const orderMapper = new BinanceOrderMapper(statusNormalizer);
  const tickerMapper = new BinanceTicker24hrMapper();
  const orderBookMapper = new BinanceOrderBookMapper();
  const tradeMapper = new BinanceTradeMapper();
  const accountMapper = new BinanceAccountMapper();

  const wsStreamManager = {
    connect: jest.fn(),
    disconnect: jest.fn(),
    stop: jest.fn(),
    subscribe: jest.fn().mockReturnValue('sub-id'),
    unsubscribe: jest.fn(),
    unsubscribeAll: jest.fn(),
    getMetrics: jest.fn(),
    state: 'DISCONNECTED',
  } as unknown as import('@modules/exchange/adapters/binance/ws/binance-ws-stream-manager').BinanceWsStreamManager;

  return new BinanceSpotAdapter(
    logger,
    symbolNormalizer,
    statusNormalizer,
    orderValidator,
    restClient as unknown as BinanceRestClient,
    serverTimeService,
    rateLimitManager,
    exchangeInfoMapper,
    orderMapper,
    tickerMapper,
    orderBookMapper,
    tradeMapper,
    accountMapper,
    wsStreamManager,
  );
}

describe('BinanceSpotAdapter', () => {
  let restClient: ReturnType<typeof makeRestClient>;
  let adapter: BinanceSpotAdapter;

  beforeEach(() => {
    restClient = makeRestClient();
    adapter = makeAdapter(restClient);
  });

  describe('exchangeId and capabilities', () => {
    it('has exchangeId = BINANCE_SPOT', () => {
      expect(adapter.exchangeId).toBe(ExchangeId.BINANCE_SPOT);
    });

    it('declares supportsSpot = true', () => {
      expect(adapter.capabilities.supportsSpot).toBe(true);
    });

    it('declares supportsFutures = false', () => {
      expect(adapter.capabilities.supportsFutures).toBe(false);
    });

    it('declares supportsWebSocket = true (WS implemented in M6)', () => {
      expect(adapter.capabilities.supportsWebSocket).toBe(true);
    });
  });

  describe('initializeInternal()', () => {
    it('fetches server time and exchange info on init', async () => {
      restClient.execute
        .mockResolvedValueOnce(ok({ serverTime: Date.now() })) // server time
        .mockResolvedValueOnce(ok(MOCK_EXCHANGE_INFO)); // exchange info

      const result = await adapter.initialize();
      expect(result.isOk()).toBe(true);
      expect(restClient.execute).toHaveBeenCalledTimes(2);
    });

    it('seeds the SymbolNormalizer with BTCUSDT mapping', async () => {
      restClient.execute
        .mockResolvedValueOnce(ok({ serverTime: Date.now() }))
        .mockResolvedValueOnce(ok(MOCK_EXCHANGE_INFO));

      await adapter.initialize();

      const r = (
        adapter as unknown as { symbolNormalizer: SymbolNormalizer }
      ).symbolNormalizer.normalize('BTCUSDT', ExchangeId.BINANCE_SPOT);
      expect(r.isOk()).toBe(true);
      if (r.isOk()) expect(r.value).toBe('BTC/USDT');
    });

    it('returns ExchangeConnectionError when server time fetch fails', async () => {
      restClient.execute.mockResolvedValueOnce(
        err(new ExchangeConnectionError(ExchangeId.BINANCE_SPOT)),
      );

      const result = await adapter.initialize();
      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error).toBeInstanceOf(ExchangeConnectionError);
    });
  });

  describe('ping()', () => {
    it('returns latency in ms on success', async () => {
      restClient.execute.mockResolvedValueOnce(ok({}));
      const result = await adapter.ping();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeGreaterThanOrEqual(0);
      }
    });

    it('propagates errors from the rest client', async () => {
      restClient.execute.mockResolvedValueOnce(
        err(new ExchangeConnectionError(ExchangeId.BINANCE_SPOT)),
      );
      const result = await adapter.ping();
      expect(result.isErr()).toBe(true);
    });
  });

  describe('getTicker()', () => {
    it('resolves the exchange symbol via SymbolNormalizer', async () => {
      // First initialize to seed the normalizer
      restClient.execute
        .mockResolvedValueOnce(ok({ serverTime: Date.now() }))
        .mockResolvedValueOnce(ok(MOCK_EXCHANGE_INFO));
      await adapter.initialize();

      restClient.execute.mockResolvedValueOnce(
        ok({
          symbol: 'BTCUSDT',
          priceChange: '-100',
          priceChangePercent: '-0.2',
          weightedAvgPrice: '49950',
          prevClosePrice: '50100',
          lastPrice: '50000',
          lastQty: '0.001',
          bidPrice: '49999',
          bidQty: '1',
          askPrice: '50001',
          askQty: '1',
          openPrice: '50100',
          highPrice: '50500',
          lowPrice: '49800',
          volume: '1000',
          quoteVolume: '50000000',
          openTime: 1699913600000,
          closeTime: 1700000000000,
          firstId: 1,
          lastId: 100,
          count: 100,
        }),
      );

      const result = await adapter.getTicker(BTCUSDT);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.lastPrice).toBe(50000);
        expect(result.value.symbol).toBe(BTCUSDT);
      }
    });
  });

  describe('getExchangeInfo() — caching', () => {
    it('returns cached exchange info on second call', async () => {
      restClient.execute
        .mockResolvedValueOnce(ok({ serverTime: Date.now() }))
        .mockResolvedValueOnce(ok(MOCK_EXCHANGE_INFO));
      await adapter.initialize();

      const r1 = await adapter.getExchangeInfo();
      const r2 = await adapter.getExchangeInfo();
      // Only 2 execute calls (init: serverTime + exchangeInfo), no 3rd call for 2nd getExchangeInfo
      expect(restClient.execute).toHaveBeenCalledTimes(2);
      expect(r1.isOk()).toBe(true);
      expect(r2.isOk()).toBe(true);
    });
  });

  describe('submitOrder() — validation', () => {
    beforeEach(async () => {
      restClient.execute
        .mockResolvedValueOnce(ok({ serverTime: Date.now() }))
        .mockResolvedValueOnce(ok(MOCK_EXCHANGE_INFO));
      await adapter.initialize();
    });

    it('validates the order before submitting', async () => {
      restClient.execute.mockResolvedValueOnce(ok(MOCK_ORDER));

      const result = await adapter.submitOrder({
        symbol: BTCUSDT,
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        quantity: 0.001,
        price: 50000,
      });

      expect(result.isOk()).toBe(true);
    });

    it('rejects orders that fail validation (quantity too small)', async () => {
      const result = await adapter.submitOrder({
        symbol: BTCUSDT,
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        quantity: 0.000001, // below minQty
        price: 50000,
      });

      expect(result.isErr()).toBe(true);
      // Should not have called the rest client for the order
      expect(restClient.execute).not.toHaveBeenCalledWith(
        expect.objectContaining({ endpoint: '/api/v3/order', method: 'POST' }),
      );
    });
  });

  describe('cancelAllOrders()', () => {
    it('returns error when no symbol is provided', async () => {
      const result = await adapter.cancelAllOrders();
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(ExchangeUnsupportedOperationError);
      }
    });
  });

  describe('WebSocket subscriptions (M6)', () => {
    it('subscribeToTicker returns err when symbol not mapped', async () => {
      const result = await adapter.subscribeToTicker(BTCUSDT);
      expect(result.isErr()).toBe(true);
    });

    it('subscribeToOrderBook returns err when symbol not mapped', async () => {
      const result = await adapter.subscribeToOrderBook(BTCUSDT);
      expect(result.isErr()).toBe(true);
    });

    it('subscribeToTrades returns err when symbol not mapped', async () => {
      const result = await adapter.subscribeToTrades(BTCUSDT);
      expect(result.isErr()).toBe(true);
    });
  });

  describe('Position operations (not applicable to spot)', () => {
    it('getOpenPositions returns empty array (no positions on spot)', async () => {
      const result = await adapter.getOpenPositions();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) expect(result.value).toHaveLength(0);
    });

    it('getLeverage returns ExchangeUnsupportedOperationError', async () => {
      const result = await adapter.getLeverage(BTCUSDT);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error).toBeInstanceOf(ExchangeUnsupportedOperationError);
    });

    it('getFundingRate returns ExchangeUnsupportedOperationError', async () => {
      const result = await adapter.getFundingRate(BTCUSDT);
      expect(result.isErr()).toBe(true);
    });
  });

  describe('isMaintenanceMode()', () => {
    it('returns false before initialization', () => {
      expect(adapter.isMaintenanceMode()).toBe(false);
    });
  });

  describe('getRateLimitStatus()', () => {
    it('returns rate limit status without making an API call', () => {
      const result = adapter.getRateLimitStatus();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBeGreaterThan(0);
        expect(restClient.execute).not.toHaveBeenCalled();
      }
    });
  });

  describe('isFeatureSupported()', () => {
    it('returns true for supportsSpot', () => {
      expect(adapter.isFeatureSupported('supportsSpot')).toBe(true);
    });

    it('returns false for supportsFutures', () => {
      expect(adapter.isFeatureSupported('supportsFutures')).toBe(false);
    });
  });
});
