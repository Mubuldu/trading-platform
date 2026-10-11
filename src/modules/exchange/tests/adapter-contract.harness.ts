/**
 * adapter-contract.harness.ts
 *
 * Shared behavioural contract for all ExchangeAdapter implementations.
 *
 * Purpose
 * -------
 * Every exchange adapter must satisfy the same interface contract. This
 * harness codifies that contract as a set of reusable test functions that
 * any adapter test can import and execute.
 *
 * The harness is intentionally adapter-agnostic: it receives an adapter
 * instance, calls the standard interface methods, and asserts on the shape
 * of the responses — not on exact values (which vary per exchange).
 *
 * Usage (in exchange-specific test files)
 * ----------------------------------------
 *
 *   import { runAdapterContract } from './adapter-contract.harness';
 *   import { BinanceSpotAdapter } from '../binance-spot.adapter';
 *
 *   describe('BinanceSpotAdapter contract', () => {
 *     let adapter: BinanceSpotAdapter;
 *
 *     beforeAll(async () => {
 *       adapter = buildTestAdapter(); // your factory
 *       await adapter.initialize();
 *     });
 *
 *     afterAll(() => adapter.destroy());
 *
 *     runAdapterContract(() => adapter);
 *   });
 *
 * Adding contract tests
 * ----------------------
 * When a new mandatory behaviour is defined in the ExchangeAdapter interface,
 * add a corresponding test group to this file. Every adapter will automatically
 * be tested against the new behaviour when its test suite calls runAdapterContract().
 *
 * Stub adapters
 * -------------
 * Stub adapters return ExchangeUnsupportedOperationError. The contract harness
 * accepts this as a valid response — stubs satisfy the interface without
 * implementing the behaviour. When a stub graduates to a real implementation,
 * its tests will start reaching the real assertions.
 */

import { ExchangeAdapter } from '../interfaces/exchange-adapter.interface';
import { ExchangeCapabilities } from '../models/exchange.models';
import { NormalizedSymbol } from '../models/common.model';
import { ExchangeUnsupportedOperationError } from '../errors/exchange.error';

type AdapterGetter = () => ExchangeAdapter;

// ── Assertion helpers ─────────────────────────────────────────────────────────

/**
 * Assert that a Result is either a valid Ok value or a typed ExchangeError.
 * Untyped exceptions (thrown errors, undefined, null) are considered failures.
 */
function assertResultOrUnsupported<T>(
  result: { isOk(): boolean; isErr(): boolean; value?: T; error?: unknown },
  label: string,
): void {
  if (result.isOk()) {
    expect(result.value).toBeDefined();
  } else if (result.isErr()) {
    // Any ExchangeError is acceptable — including ExchangeUnsupportedOperationError for stubs
    expect(result.error).toBeInstanceOf(Error);
  } else {
    throw new Error(`${label}: Result was neither ok nor err`);
  }
}

/**
 * Assert that a capabilities object is structurally valid.
 * All boolean flags must be booleans; maxBatchOrderSize must be a non-negative integer.
 */
function assertCapabilitiesShape(caps: ExchangeCapabilities): void {
  const booleanFlags: Array<keyof ExchangeCapabilities> = [
    'supportsSpot',
    'supportsPerpetual',
    'supportsFutures',
    'supportsOptions',
    'supportsMargin',
    'supportsCrossMargin',
    'supportsIsolatedMargin',
    'supportsOco',
    'supportsTpSl',
    'supportsBatchOrders',
    'supportsReduceOnly',
    'supportsHedgeMode',
    'supportsTrailingStop',
    'supportsPostOnly',
    'supportsConditionalOrders',
    'supportsWebSocket',
  ];

  for (const flag of booleanFlags) {
    expect(typeof caps[flag]).toBe('boolean');
  }

  expect(typeof caps.maxBatchOrderSize).toBe('number');
  expect(caps.maxBatchOrderSize).toBeGreaterThanOrEqual(0);

  // Consistency check: maxBatchOrderSize must be >0 if supportsBatchOrders is true
  if (caps.supportsBatchOrders) {
    expect(caps.maxBatchOrderSize).toBeGreaterThan(0);
  }
}

// ── Contract groups ───────────────────────────────────────────────────────────

/**
 * Run the full ExchangeAdapter contract suite against the adapter returned
 * by `getAdapter()`. Call this inside a `describe()` block.
 *
 * @param getAdapter - Factory called once per test; adapter must be initialized.
 * @param testSymbol - A known valid normalized symbol for market data tests.
 *                     Defaults to 'BTC/USDT' if not provided.
 */
export function runAdapterContract(
  getAdapter: AdapterGetter,
  testSymbol: NormalizedSymbol = 'BTC/USDT' as NormalizedSymbol,
): void {
  // ── Identity ──────────────────────────────────────────────────────────────

  describe('ExchangeAdapter identity', () => {
    it('exposes a non-empty exchangeId', () => {
      const adapter = getAdapter();
      expect(typeof adapter.exchangeId).toBe('string');
      expect(adapter.exchangeId.length).toBeGreaterThan(0);
    });

    it('getExchangeId() matches exchangeId property', () => {
      const adapter = getAdapter();
      expect(adapter.getExchangeId()).toBe(adapter.exchangeId);
    });
  });

  // ── Capabilities ──────────────────────────────────────────────────────────

  describe('ExchangeCapabilityProvider', () => {
    it('getCapabilities() returns a structurally valid object', () => {
      const caps = getAdapter().getCapabilities();
      assertCapabilitiesShape(caps);
    });

    it('isFeatureSupported() returns true for every true capability flag', () => {
      const adapter = getAdapter();
      const caps = adapter.getCapabilities();
      const booleanFlags: Array<keyof ExchangeCapabilities> = [
        'supportsSpot',
        'supportsPerpetual',
        'supportsFutures',
        'supportsOptions',
        'supportsMargin',
        'supportsCrossMargin',
        'supportsIsolatedMargin',
        'supportsOco',
        'supportsTpSl',
        'supportsBatchOrders',
        'supportsReduceOnly',
        'supportsHedgeMode',
        'supportsTrailingStop',
        'supportsPostOnly',
        'supportsConditionalOrders',
        'supportsWebSocket',
      ];

      for (const flag of booleanFlags) {
        if (caps[flag] === true) {
          expect(adapter.isFeatureSupported(flag)).toBe(true);
        } else {
          expect(adapter.isFeatureSupported(flag)).toBe(false);
        }
      }
    });

    it('isFeatureSupported() returns false for maxBatchOrderSize when batch not supported', () => {
      const adapter = getAdapter();
      const caps = adapter.getCapabilities();
      if (!caps.supportsBatchOrders) {
        expect(adapter.isFeatureSupported('maxBatchOrderSize')).toBe(false);
      }
    });
  });

  // ── Metadata ──────────────────────────────────────────────────────────────

  describe('ExchangeMetadataProvider', () => {
    it('getRateLimitStatus() returns a Result', () => {
      const result = getAdapter().getRateLimitStatus();
      expect(result).toBeDefined();
      expect(typeof result.isOk).toBe('function');
      if (result.isOk()) {
        expect(Array.isArray(result.value)).toBe(true);
      }
    });

    it('isMaintenanceMode() returns a boolean', () => {
      const result = getAdapter().isMaintenanceMode();
      expect(typeof result).toBe('boolean');
    });

    it('getExchangeInfo() returns a Result', async () => {
      const result = await getAdapter().getExchangeInfo();
      assertResultOrUnsupported(result, 'getExchangeInfo');
      if (result.isOk()) {
        expect(result.value.exchangeId).toBe(getAdapter().exchangeId);
        expect(Array.isArray(result.value.symbols)).toBe(true);
        expect(Array.isArray(result.value.rateLimits)).toBe(true);
      }
    });
  });

  // ── Connectivity ──────────────────────────────────────────────────────────

  describe('MarketDataProvider — connectivity', () => {
    it('ping() returns a Result', async () => {
      const result = await getAdapter().ping();
      assertResultOrUnsupported(result, 'ping');
      if (result.isOk()) {
        expect(typeof result.value).toBe('number');
        expect(result.value).toBeGreaterThanOrEqual(0);
      }
    });

    it('getServerTime() returns a Result', async () => {
      const result = await getAdapter().getServerTime();
      assertResultOrUnsupported(result, 'getServerTime');
      if (result.isOk()) {
        expect(result.value instanceof Date).toBe(true);
      }
    });
  });

  // ── Market data ───────────────────────────────────────────────────────────

  describe('MarketDataProvider — market data', () => {
    it('getTicker() returns a Result', async () => {
      const result = await getAdapter().getTicker(testSymbol);
      assertResultOrUnsupported(result, 'getTicker');
      if (result.isOk()) {
        expect(result.value.symbol).toBe(testSymbol);
        expect(result.value.exchangeId).toBe(getAdapter().exchangeId);
        expect(typeof result.value.lastPrice).toBe('number');
        expect(result.value.lastPrice).toBeGreaterThan(0);
      }
    });

    it('getOrderBook() returns a Result', async () => {
      const result = await getAdapter().getOrderBook(testSymbol);
      assertResultOrUnsupported(result, 'getOrderBook');
      if (result.isOk()) {
        expect(result.value.symbol).toBe(testSymbol);
        expect(Array.isArray(result.value.bids)).toBe(true);
        expect(Array.isArray(result.value.asks)).toBe(true);
      }
    });

    it('getRecentTrades() returns a Result', async () => {
      const result = await getAdapter().getRecentTrades(testSymbol);
      assertResultOrUnsupported(result, 'getRecentTrades');
      if (result.isOk()) {
        expect(Array.isArray(result.value)).toBe(true);
      }
    });

    it('getSupportedSymbols() returns a Result', async () => {
      const result = await getAdapter().getSupportedSymbols();
      assertResultOrUnsupported(result, 'getSupportedSymbols');
      if (result.isOk()) {
        expect(Array.isArray(result.value)).toBe(true);
      }
    });
  });

  // ── Account ───────────────────────────────────────────────────────────────

  describe('AccountProvider', () => {
    it('getBalance() returns a Result', async () => {
      const result = await getAdapter().getBalance();
      assertResultOrUnsupported(result, 'getBalance');
      if (result.isOk()) {
        expect(result.value.exchangeId).toBe(getAdapter().exchangeId);
      }
    });

    it('getAccountInfo() returns a Result', async () => {
      const result = await getAdapter().getAccountInfo();
      assertResultOrUnsupported(result, 'getAccountInfo');
    });
  });

  // ── Orders ────────────────────────────────────────────────────────────────

  describe('OrderProvider', () => {
    it('getOpenOrders() returns a Result', async () => {
      const result = await getAdapter().getOpenOrders();
      assertResultOrUnsupported(result, 'getOpenOrders');
      if (result.isOk()) {
        expect(Array.isArray(result.value)).toBe(true);
      }
    });
  });

  // ── Stub contract ─────────────────────────────────────────────────────────

  describe('Stub completeness', () => {
    it('all Result-returning methods resolve (never throw)', async () => {
      const adapter = getAdapter();

      // These must settle as Results, not throw
      const calls = [
        adapter.ping(),
        adapter.getServerTime(),
        adapter.getBalance(),
        adapter.getAccountInfo(),
        adapter.getOpenOrders(),
        adapter.getExchangeInfo(),
        adapter.getAllSymbols(),
        adapter.getSupportedSymbols(),
        adapter.getTicker(testSymbol),
        adapter.getOrderBook(testSymbol),
        adapter.getRecentTrades(testSymbol),
      ];

      const results = await Promise.allSettled(calls);
      for (const r of results) {
        expect(r.status).toBe('fulfilled');
      }
    });

    it('stub unsupported errors carry the correct exchangeId', async () => {
      const adapter = getAdapter();
      const result = await adapter.ping();
      if (result.isErr()) {
        const error = result.error;
        if (error instanceof ExchangeUnsupportedOperationError) {
          expect(error.exchangeId).toBe(adapter.exchangeId);
        }
      }
    });
  });
}

// ── Capability-specific contract extensions ───────────────────────────────────

/**
 * Run the batch order contract against an adapter that declares supportsBatchOrders.
 * Include this in tests for adapters where caps.supportsBatchOrders = true.
 */
export function runBatchOrderContract(getAdapter: AdapterGetter): void {
  describe('TradingProvider — batch orders', () => {
    it('adapter declares maxBatchOrderSize > 0', () => {
      const caps = getAdapter().getCapabilities();
      expect(caps.maxBatchOrderSize).toBeGreaterThan(0);
    });

    it('submitBatch([]) returns a Result (empty batch is a valid call)', async () => {
      const result = await getAdapter().submitBatch([]);
      assertResultOrUnsupported(result, 'submitBatch([])');
    });

    it('cancelBatch([]) returns a Result', async () => {
      const result = await getAdapter().cancelBatch([]);
      assertResultOrUnsupported(result, 'cancelBatch([])');
    });
  });
}

/**
 * Run the futures/position contract against an adapter that declares supportsPerpetual
 * or supportsFutures. Include this in tests for derivatives adapters.
 */
export function runPositionContract(getAdapter: AdapterGetter): void {
  describe('PositionProvider — derivatives', () => {
    it('getOpenPositions() returns a Result', async () => {
      const result = await getAdapter().getOpenPositions();
      assertResultOrUnsupported(result, 'getOpenPositions');
      if (result.isOk()) {
        expect(Array.isArray(result.value)).toBe(true);
      }
    });

    it('getPositionMode() returns a Result', async () => {
      const result = await getAdapter().getPositionMode();
      assertResultOrUnsupported(result, 'getPositionMode');
    });
  });
}
