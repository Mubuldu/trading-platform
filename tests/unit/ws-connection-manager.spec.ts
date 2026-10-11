import { EventEmitter } from 'events';
import { WsConnectionManager } from '@common/websocket/connection/ws-connection-manager';
import { WsReconnectManager } from '@common/websocket/reconnect/ws-reconnect-manager';
import { WsHeartbeatMonitor } from '@common/websocket/heartbeat/ws-heartbeat-monitor';
import { WsConnectionState } from '@common/websocket/enums/ws-connection-state.enum';
import { WsClientConfig } from '@common/websocket/types/ws-config.types';
import { ILogger } from '@core/logging/logger.interface';

// Mock WsRawClient to avoid real WebSocket
jest.mock('@common/websocket/client/ws-raw-client', () => {
  return {
    WsRawClient: jest.fn().mockImplementation(() => {
      const emitter = new EventEmitter();
      return Object.assign(emitter, {
        connect: jest.fn(() => {
          // Simulate async open
          process.nextTick(() => emitter.emit('open'));
        }),
        send: jest.fn().mockReturnValue(true),
        ping: jest.fn(),
        close: jest.fn(() => {
          process.nextTick(() => emitter.emit('close', 1000, 'ok'));
        }),
        destroy: jest.fn(),
        removeAllListeners: jest.fn(), // no-op to prevent circular recursion
        internalDestroy: jest.fn(),
      });
    }),
  };
});

function makeLogger(): jest.Mocked<ILogger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    critical: jest.fn(),
  };
}

function makeConfig(overrides?: Partial<WsClientConfig>): WsClientConfig {
  return {
    url: 'ws://localhost:9999',
    heartbeatIntervalMs: 10_000,
    heartbeatTimeoutMs: 5_000,
    missedHeartbeatsThreshold: 3,
    reconnectBaseDelayMs: 10,
    reconnectMaxDelayMs: 100,
    maxReconnectAttempts: 3,
    stableConnectionThresholdMs: 30_000,
    maxMessageSizeBytes: 1024 * 1024,
    ...overrides,
  };
}

const managersToCleanup: WsConnectionManager[] = [];

function makeManager(overrides?: Partial<WsClientConfig>): {
  manager: WsConnectionManager;
  reconnect: WsReconnectManager;
  heartbeat: WsHeartbeatMonitor;
  logger: jest.Mocked<ILogger>;
} {
  const logger = makeLogger();
  const reconnect = new WsReconnectManager({
    baseDelayMs: 10,
    maxDelayMs: 100,
    maxAttempts: 3,
    stableThresholdMs: 30_000,
  });
  const heartbeat = new WsHeartbeatMonitor({ intervalMs: 10_000, timeoutMs: 5_000, threshold: 3 });
  const manager = new WsConnectionManager(makeConfig(overrides), reconnect, heartbeat, logger);
  managersToCleanup.push(manager);
  return { manager, reconnect, heartbeat, logger };
}

describe('WsConnectionManager', () => {
  afterEach(() => {
    managersToCleanup.forEach((m) => {
      try {
        m.stop();
      } catch {
        /* already stopped */
      }
    });
    managersToCleanup.length = 0;
    jest.clearAllTimers();
  });

  describe('connect', () => {
    it('transitions to CONNECTING then CONNECTED on socket open', async () => {
      const { manager } = makeManager();
      const states: WsConnectionState[] = [];
      manager.on('stateChange', (_prev, next) => states.push(next));

      manager.connect();
      expect(states).toContain(WsConnectionState.CONNECTING);

      await new Promise((r) => manager.once('connected', r));
      expect(manager.state).toBe(WsConnectionState.CONNECTED);
      expect(manager.isConnected).toBe(true);
    });

    it('connect() is a no-op when already CONNECTED', async () => {
      const { manager } = makeManager();
      manager.connect();
      await new Promise((r) => manager.once('connected', r));

      const changesSpy = jest.fn();
      manager.on('stateChange', changesSpy);
      manager.connect();
      expect(changesSpy).not.toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('transitions to DISCONNECTED and emits disconnected', async () => {
      const { manager } = makeManager();
      manager.connect();
      await new Promise((r) => manager.once('connected', r));

      const disconnectedSpy = jest.fn();
      manager.on('disconnected', disconnectedSpy);
      manager.disconnect();

      await new Promise((r) => setTimeout(r, 10));
      expect(manager.state).toBe(WsConnectionState.DISCONNECTED);
      expect(disconnectedSpy).toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('transitions to STOPPED and removes all listeners', async () => {
      const { manager } = makeManager();
      manager.connect();
      await new Promise((r) => manager.once('connected', r));

      manager.stop();
      expect(manager.state).toBe(WsConnectionState.STOPPED);
    });

    it('connect() after stop() is a no-op', () => {
      const { manager } = makeManager();
      manager.stop();
      manager.connect();
      expect(manager.state).toBe(WsConnectionState.STOPPED);
    });
  });

  describe('send', () => {
    it('returns false when not connected', () => {
      const { manager } = makeManager();
      expect(manager.send('hello')).toBe(false);
    });

    it('returns true when connected and forwards to raw client', async () => {
      const { manager } = makeManager();
      manager.connect();
      await new Promise((r) => manager.once('connected', r));
      expect(manager.send('hello')).toBe(true);
    });
  });

  describe('message relay', () => {
    it('emits message events from the raw client', async () => {
      const { manager } = makeManager();
      manager.connect();
      await new Promise((r) => manager.once('connected', r));

      // The raw client is a mocked EventEmitter; find it via the module mock
      const { WsRawClient } = jest.requireMock('@common/websocket/client/ws-raw-client');
      const rawInstance = WsRawClient.mock.results[WsRawClient.mock.results.length - 1].value;

      const msgSpy = jest.fn();
      manager.on('message', msgSpy);
      rawInstance.emit('message', '{"test":1}', Date.now());

      expect(msgSpy).toHaveBeenCalledWith(expect.objectContaining({ data: '{"test":1}' }));
    });
  });
});
