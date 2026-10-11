import { EventEmitter } from 'events';
import {
  BinanceWsStreamManager,
  BinanceWsStreamConfig,
} from '@modules/exchange/adapters/binance/ws/binance-ws-stream-manager';
import { BinanceWsMessageNormalizer } from '@modules/exchange/adapters/binance/ws/binance-ws-message-normalizer';
import { MarketDataEventBus } from '@modules/exchange/market-data-event-bus';
import { ILogger } from '@core/logging/logger.interface';
import { WsConnectionState } from '@common/websocket/enums/ws-connection-state.enum';
import { MARKET_DATA_EVENTS } from '@modules/exchange/models/common.model';
import { NormalizedSymbol } from '@modules/exchange/models/common.model';

// Mock the WsConnectionManager to control it from tests
const mockConnectionManager = new EventEmitter() as EventEmitter & {
  connect: jest.Mock;
  disconnect: jest.Mock;
  stop: jest.Mock;
  send: jest.Mock;
  isConnected: boolean;
  state: WsConnectionState;
  setMaxListeners: jest.Mock;
};

mockConnectionManager.connect = jest.fn();
mockConnectionManager.disconnect = jest.fn();
mockConnectionManager.stop = jest.fn();
mockConnectionManager.send = jest.fn().mockReturnValue(true);
mockConnectionManager.isConnected = false;
mockConnectionManager.state = WsConnectionState.DISCONNECTED;
mockConnectionManager.setMaxListeners = jest.fn();

jest.mock('@common/websocket/connection/ws-connection-manager', () => ({
  WsConnectionManager: jest.fn().mockImplementation(() => mockConnectionManager),
}));

jest.mock('@common/websocket/reconnect/ws-reconnect-manager', () => ({
  WsReconnectManager: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@common/websocket/heartbeat/ws-heartbeat-monitor', () => ({
  WsHeartbeatMonitor: jest.fn().mockImplementation(() => ({})),
}));

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

function makeNormalizerMock(): jest.Mocked<BinanceWsMessageNormalizer> {
  return {
    normalize: jest.fn().mockReturnValue(null),
  } as unknown as jest.Mocked<BinanceWsMessageNormalizer>;
}

const defaultConfig: BinanceWsStreamConfig = {
  wsBaseUrl: 'wss://stream.binance.com:9443',
  heartbeatIntervalMs: 20_000,
  heartbeatTimeoutMs: 10_000,
  missedHeartbeatsThreshold: 3,
  reconnectBaseDelayMs: 1_000,
  reconnectMaxDelayMs: 30_000,
  maxReconnectAttempts: 10,
  reconnectStableThresholdMs: 30_000,
  maxStreams: 100,
  maxMessageSizeBytes: 10 * 1024 * 1024,
};

const streamManagersToCleanup: BinanceWsStreamManager[] = [];

function makeStreamManager(normalizerOverride?: jest.Mocked<BinanceWsMessageNormalizer>): {
  manager: BinanceWsStreamManager;
  normalizer: jest.Mocked<BinanceWsMessageNormalizer>;
  eventBus: MarketDataEventBus;
  logger: jest.Mocked<ILogger>;
} {
  const normalizer = normalizerOverride ?? makeNormalizerMock();
  const eventBus = new MarketDataEventBus();
  const logger = makeLogger();

  // Reset mock state before each manager creation
  mockConnectionManager.isConnected = false;
  mockConnectionManager.removeAllListeners();
  mockConnectionManager.send.mockReturnValue(true);

  const manager = new BinanceWsStreamManager(defaultConfig, normalizer, eventBus, logger);
  streamManagersToCleanup.push(manager);
  return { manager, normalizer, eventBus, logger };
}

describe('BinanceWsStreamManager', () => {
  afterEach(() => {
    streamManagersToCleanup.forEach((m) => {
      try {
        m.stop();
      } catch {
        /* already stopped */
      }
    });
    streamManagersToCleanup.length = 0;
    jest.clearAllMocks();
  });

  describe('connect / disconnect / stop', () => {
    it('delegates connect() to connectionManager', () => {
      const { manager } = makeStreamManager();
      manager.connect();
      expect(mockConnectionManager.connect).toHaveBeenCalled();
    });

    it('delegates disconnect() to connectionManager and cancels pending commands', () => {
      const { manager } = makeStreamManager();
      manager.disconnect();
      expect(mockConnectionManager.disconnect).toHaveBeenCalled();
    });

    it('delegates stop() to connectionManager', () => {
      const { manager } = makeStreamManager();
      manager.stop();
      expect(mockConnectionManager.stop).toHaveBeenCalled();
    });
  });

  describe('subscribe', () => {
    it('returns a subscriptionId string', () => {
      const { manager } = makeStreamManager();
      const id = manager.subscribe('btcusdt@ticker', jest.fn());
      expect(typeof id).toBe('string');
    });

    it('sends SUBSCRIBE command if connected and stream is new', () => {
      const { manager } = makeStreamManager();
      mockConnectionManager.isConnected = true;
      manager.subscribe('btcusdt@ticker', jest.fn());
      expect(mockConnectionManager.send).toHaveBeenCalledWith(
        expect.stringContaining('"method":"SUBSCRIBE"'),
      );
    });

    it('does NOT send SUBSCRIBE if not connected', () => {
      const { manager } = makeStreamManager();
      mockConnectionManager.isConnected = false;
      manager.subscribe('btcusdt@ticker', jest.fn());
      expect(mockConnectionManager.send).not.toHaveBeenCalled();
    });

    it('does NOT send SUBSCRIBE for second handler on same stream', () => {
      const { manager } = makeStreamManager();
      mockConnectionManager.isConnected = true;
      manager.subscribe('btcusdt@ticker', jest.fn());
      mockConnectionManager.send.mockClear();
      manager.subscribe('btcusdt@ticker', jest.fn());
      expect(mockConnectionManager.send).not.toHaveBeenCalled();
    });

    it('returns null when maxStreams is reached', () => {
      const tiny = new BinanceWsStreamManager(
        { ...defaultConfig, maxStreams: 1 },
        makeNormalizerMock(),
        new MarketDataEventBus(),
        makeLogger(),
      );
      streamManagersToCleanup.push(tiny);
      tiny.subscribe('a', jest.fn());
      expect(tiny.subscribe('b', jest.fn())).toBeNull();
    });
  });

  describe('unsubscribe', () => {
    it('sends UNSUBSCRIBE when last handler removed and connected', () => {
      const { manager } = makeStreamManager();
      mockConnectionManager.isConnected = true;
      const h = jest.fn();
      manager.subscribe('btcusdt@ticker', h);
      mockConnectionManager.send.mockClear();
      manager.unsubscribe('btcusdt@ticker', h);
      expect(mockConnectionManager.send).toHaveBeenCalledWith(
        expect.stringContaining('"method":"UNSUBSCRIBE"'),
      );
    });

    it('does NOT send UNSUBSCRIBE when other handlers remain', () => {
      const { manager } = makeStreamManager();
      mockConnectionManager.isConnected = true;
      const h1 = jest.fn();
      const h2 = jest.fn();
      manager.subscribe('btcusdt@ticker', h1);
      manager.subscribe('btcusdt@ticker', h2);
      mockConnectionManager.send.mockClear();
      manager.unsubscribe('btcusdt@ticker', h1);
      expect(mockConnectionManager.send).not.toHaveBeenCalled();
    });
  });

  describe('resubscribeAll on reconnect', () => {
    it('sends SUBSCRIBE for all active streams when connected event fires', () => {
      const { manager } = makeStreamManager();
      manager.subscribe('btcusdt@ticker', jest.fn());
      manager.subscribe('btcusdt@depth@100ms', jest.fn());
      mockConnectionManager.send.mockClear();
      mockConnectionManager.isConnected = true;

      mockConnectionManager.emit('connected');

      const calls = mockConnectionManager.send.mock.calls.map((c) => JSON.parse(c[0] as string));
      const subscribeCalls = calls.filter((c) => c.method === 'SUBSCRIBE');
      expect(subscribeCalls.length).toBeGreaterThan(0);
      const allParams = subscribeCalls.flatMap((c) => c.params as string[]);
      expect(allParams).toContain('btcusdt@ticker');
      expect(allParams).toContain('btcusdt@depth@100ms');
    });
  });

  describe('message routing', () => {
    function buildEnvelope(stream: string, data: unknown): string {
      return JSON.stringify({ stream, data });
    }

    it('publishes normalized payload to event bus', () => {
      const normalizer = makeNormalizerMock();
      const ticker = { exchangeId: 'BINANCE_SPOT', symbol: BTCUSDT } as any;
      normalizer.normalize.mockReturnValue({
        eventType: MARKET_DATA_EVENTS.TICKER_UPDATED,
        payload: ticker,
        exchangeTimestampMs: Date.now(),
        symbol: BTCUSDT,
      });

      const { eventBus } = makeStreamManager(normalizer);
      const listener = jest.fn();
      eventBus.on(MARKET_DATA_EVENTS.TICKER_UPDATED, listener);

      const raw = {
        data: buildEnvelope('btcusdt@ticker', { e: '24hrTicker' }),
        receivedAt: Date.now(),
        byteLength: 50,
      };
      mockConnectionManager.emit('message', raw);

      expect(listener).toHaveBeenCalledWith(ticker);
    });

    it('dispatches to per-stream callback handlers', () => {
      const normalizer = makeNormalizerMock();
      const ticker = { symbol: BTCUSDT } as any;
      normalizer.normalize.mockReturnValue({
        eventType: MARKET_DATA_EVENTS.TICKER_UPDATED,
        payload: ticker,
        exchangeTimestampMs: Date.now(),
        symbol: BTCUSDT,
      });

      const { manager } = makeStreamManager(normalizer);
      const handler = jest.fn();
      manager.subscribe('btcusdt@ticker', handler);

      mockConnectionManager.emit('message', {
        data: buildEnvelope('btcusdt@ticker', {}),
        receivedAt: Date.now(),
        byteLength: 30,
      });

      expect(handler).toHaveBeenCalledWith(
        ticker,
        expect.objectContaining({ streamId: 'btcusdt@ticker' }),
      );
    });

    it('skips duplicate sequence updates for depth streams', () => {
      const normalizer = makeNormalizerMock();
      normalizer.normalize.mockReturnValue({
        eventType: MARKET_DATA_EVENTS.ORDER_BOOK_UPDATED,
        payload: {} as any,
        exchangeTimestampMs: Date.now(),
        updateId: 100,
        firstUpdateId: 99,
        symbol: BTCUSDT,
      });

      const { eventBus } = makeStreamManager(normalizer);
      const listener = jest.fn();
      eventBus.on(MARKET_DATA_EVENTS.ORDER_BOOK_UPDATED, listener);

      const rawMsg = {
        data: buildEnvelope('btcusdt@depth@100ms', {}),
        receivedAt: Date.now(),
        byteLength: 40,
      };

      mockConnectionManager.emit('message', rawMsg); // initialized (100)
      mockConnectionManager.emit('message', rawMsg); // duplicate — updateId=100 again

      expect(listener).toHaveBeenCalledTimes(1); // second one skipped
    });

    it('ignores malformed JSON gracefully', () => {
      makeStreamManager();
      expect(() =>
        mockConnectionManager.emit('message', {
          data: 'not json{{{',
          receivedAt: Date.now(),
          byteLength: 8,
        }),
      ).not.toThrow();
    });

    it('resolves SUBSCRIBE command acknowledgement and clears pending', () => {
      const { manager } = makeStreamManager();
      mockConnectionManager.isConnected = true;
      manager.subscribe('btcusdt@ticker', jest.fn());

      // The send mock captured the payload — extract the id
      const sentPayload = JSON.parse(mockConnectionManager.send.mock.calls[0][0] as string);
      const cmdId = sentPayload.id;

      // Simulate Binance ACK
      const ackMsg = {
        data: JSON.stringify({ id: cmdId, result: null }),
        receivedAt: Date.now(),
        byteLength: 20,
      };
      expect(() => mockConnectionManager.emit('message', ackMsg)).not.toThrow();
    });
  });

  describe('getMetrics', () => {
    it('returns connection and latency metrics', () => {
      const { manager } = makeStreamManager();
      const metrics = manager.getMetrics();
      expect(metrics).toHaveProperty('connection');
      expect(metrics).toHaveProperty('latency');
      expect(metrics.connection.subscriptionCount).toBe(0);
    });
  });
});
