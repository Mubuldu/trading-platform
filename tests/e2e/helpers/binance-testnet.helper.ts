/**
 * Binance Testnet adapter factory for E2E tests.
 *
 * Builds a fully-wired BinanceSpotAdapter pointed at testnet.binance.vision
 * WITHOUT spinning up the NestJS DI container.
 *
 * Usage:
 *   const { adapter, cleanup } = buildTestnetAdapter(apiKey, secretKey);
 *   const initResult = await adapter.initialize(); // syncs clock + fetches ExchangeInfo
 *   // ... run assertions ...
 *   await cleanup();                                // destroys HTTPS agent
 *
 * All WS internals are replaced with no-ops — this helper targets REST tests only.
 * For WS tests, use the NestJS TestingModule instead.
 */

import { BinanceSpotAdapter } from '@modules/exchange/adapters/binance/binance-spot.adapter';
import { BinanceRestClient } from '@modules/exchange/adapters/binance/client/binance-rest.client';
import { BinanceSignatureService } from '@modules/exchange/adapters/binance/auth/binance-signature.service';
import { BinanceServerTimeService } from '@modules/exchange/adapters/binance/server-time/binance-server-time.service';
import { BinanceRateLimitManager } from '@modules/exchange/adapters/binance/rate-limit/binance-rate-limit.manager';
import { BinanceErrorMapper } from '@modules/exchange/adapters/binance/mappers/binance-error.mapper';
import { BinanceExchangeInfoMapper } from '@modules/exchange/adapters/binance/mappers/binance-exchange-info.mapper';
import {
  BinanceOrderMapper,
  BINANCE_ORDER_STATUS_MAP,
} from '@modules/exchange/adapters/binance/mappers/binance-order.mapper';
import { BinanceTicker24hrMapper } from '@modules/exchange/adapters/binance/mappers/binance-ticker.mapper';
import { BinanceOrderBookMapper } from '@modules/exchange/adapters/binance/mappers/binance-order-book.mapper';
import { BinanceTradeMapper } from '@modules/exchange/adapters/binance/mappers/binance-trade.mapper';
import { BinanceAccountMapper } from '@modules/exchange/adapters/binance/mappers/binance-account.mapper';
import { BinanceWsStreamManager } from '@modules/exchange/adapters/binance/ws/binance-ws-stream-manager';
import {
  BINANCE_TESTNET_BASE_URL,
  BINANCE_WS_TESTNET_BASE_URL,
} from '@modules/exchange/adapters/binance/config/binance.constants';
import { BinanceSpotConfig } from '@modules/exchange/adapters/binance/config/binance.config';
import { SymbolNormalizer } from '@modules/exchange/normalizers/symbol.normalizer';
import { OrderStatusNormalizer } from '@modules/exchange/normalizers/order-status.normalizer';
import { OrderValidator } from '@modules/exchange/validators/order.validator';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { ILogger } from '@core/logging/logger.interface';

// ── Silent logger (keeps test output clean) ───────────────────────────────────

function makeSilentLogger(): ILogger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    critical: () => {},
  };
}

// ── Minimal WS no-op (REST tests don't touch the WebSocket) ───────────────────

function makeNoopWsManager(): BinanceWsStreamManager {
  return {
    connect: () => {},
    disconnect: () => {},
    subscribe: () => 'noop-sub-id',
    unsubscribe: () => {},
    unsubscribeAll: () => {},
    getMetrics: () => ({}),
  } as unknown as BinanceWsStreamManager;
}

// ── Public API ────────────────────────────────────────────────────────────────

export const TEST_TESTNET_BASE_URL = BINANCE_TESTNET_BASE_URL;

export interface TestnetAdapterHandle {
  readonly adapter: BinanceSpotAdapter;
  readonly restClient: BinanceRestClient;
  /** Call in afterAll to release the HTTPS connection pool. */
  cleanup(): Promise<void>;
}

/**
 * Builds a BinanceSpotAdapter connected to testnet.binance.vision.
 *
 * @param apiKey    - Testnet API key (from https://testnet.binance.vision)
 * @param secretKey - Testnet secret key
 */
export function buildTestnetAdapter(apiKey: string, secretKey: string): TestnetAdapterHandle {
  const config: BinanceSpotConfig = {
    apiKey,
    secretKey,
    baseUrl: BINANCE_TESTNET_BASE_URL,
    testnet: true,
    timeoutMs: 15_000,
    recvWindowMs: 10_000, // wider window to tolerate testnet clock quirks
    maxRetries: 1,
    connectionPoolSize: 4,
    wsBaseUrl: BINANCE_WS_TESTNET_BASE_URL,
    wsHeartbeatIntervalMs: 20_000,
    wsHeartbeatTimeoutMs: 10_000,
    wsMissedHeartbeatsThreshold: 3,
    wsReconnectBaseDelayMs: 1_000,
    wsReconnectMaxDelayMs: 30_000,
    wsMaxReconnectAttempts: 5,
    wsReconnectStableThresholdMs: 30_000,
    wsMaxStreams: 10,
    wsMaxMessageSizeBytes: 10_485_760,
  };

  const logger = makeSilentLogger();

  const signatureService = new BinanceSignatureService();
  const serverTimeService = new BinanceServerTimeService();
  const rateLimitManager = new BinanceRateLimitManager();
  const errorMapper = new BinanceErrorMapper();

  // BinanceRestClient uses @Inject() decorators but positional args work fine
  // when calling new() directly — DI decorators are compile-time metadata only.
  const restClient = new BinanceRestClient(
    config,
    signatureService,
    serverTimeService,
    rateLimitManager,
    errorMapper,
    logger,
  );

  const symbolNormalizer = new SymbolNormalizer();
  const statusNormalizer = new OrderStatusNormalizer();
  statusNormalizer.registerMappings(ExchangeId.BINANCE_SPOT, BINANCE_ORDER_STATUS_MAP);
  const orderValidator = new OrderValidator();

  const exchangeInfoMapper = new BinanceExchangeInfoMapper();
  const orderMapper = new BinanceOrderMapper(statusNormalizer);
  const tickerMapper = new BinanceTicker24hrMapper();
  const orderBookMapper = new BinanceOrderBookMapper();
  const tradeMapper = new BinanceTradeMapper();
  const accountMapper = new BinanceAccountMapper();
  const wsStreamManager = makeNoopWsManager();

  const adapter = new BinanceSpotAdapter(
    logger,
    symbolNormalizer,
    statusNormalizer,
    orderValidator,
    restClient,
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

  return {
    adapter,
    restClient,
    cleanup: async () => {
      // disconnectInternal() calls restClient.destroy() which closes the HTTPS agent
      await adapter.disconnect();
    },
  };
}
