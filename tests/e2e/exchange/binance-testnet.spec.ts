/**
 * Binance Testnet REST connectivity E2E tests
 *
 * Verifies the full REST path against testnet.binance.vision:
 *
 *   Public (no credentials required):
 *     1. ping() returns a round-trip latency
 *     2. getServerTime() returns a recent Date
 *     3. getExchangeInfo() returns symbol metadata including BTCUSDT
 *     4. getTicker() returns valid bid/ask/price fields for BTC/USDT
 *     5. getOrderBook() returns a non-empty bid and ask ladder
 *     6. getRecentTrades() returns a list of recent market trades
 *     7. getSupportedSymbols() returns a non-empty list
 *
 *   Authenticated (requires BINANCE_SPOT_API_KEY + BINANCE_SPOT_SECRET_KEY):
 *     8. getBalance() returns a balance snapshot including USDT
 *     9. getAccountInfo() returns canTrade = true
 *    10. getOpenOrders() returns an array (may be empty)
 *
 *   Rate-limit metadata:
 *    11. getRateLimitStatus() returns an array
 *    12. isMaintenanceMode() returns false on a live testnet
 *
 * Skip conditions (ANY causes the whole suite to skip, not fail):
 *   - BINANCE_E2E_SKIP=true  (explicit opt-out)
 *   - No BINANCE_SPOT_API_KEY set  (credentials absent)
 *   - adapter.initialize() fails  (testnet unreachable)
 *
 * How to run:
 *   BINANCE_SPOT_API_KEY=xxx BINANCE_SPOT_SECRET_KEY=yyy pnpm test:e2e:testnet
 *
 * Get testnet keys at: https://testnet.binance.vision/
 */

import { OrderSide } from '@modules/exchange/enums/order.enums';
import { NormalizedSymbol } from '@modules/exchange/models/common.model';
import {
  buildTestnetAdapter,
  TEST_TESTNET_BASE_URL,
  TestnetAdapterHandle,
} from '../helpers/binance-testnet.helper';

// ── Constants ─────────────────────────────────────────────────────────────────

const BTCUSDT = NormalizedSymbol.unsafe('BTC/USDT');

// Skip if the caller opted out or has no API key configured
const SKIP =
  process.env.BINANCE_E2E_SKIP === 'true' || !process.env.BINANCE_SPOT_API_KEY;

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('Binance Testnet REST — end-to-end', () => {
  let handle: TestnetAdapterHandle;
  let available = false;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  beforeAll(async () => {
    if (SKIP) {
      console.warn(
        `\n⚠  Binance testnet E2E tests skipped.` +
          `\n   Reason: ${
            process.env.BINANCE_E2E_SKIP === 'true'
              ? 'BINANCE_E2E_SKIP=true'
              : 'BINANCE_SPOT_API_KEY not set'
          }` +
          `\n   To run: BINANCE_SPOT_API_KEY=xxx BINANCE_SPOT_SECRET_KEY=yyy pnpm test:e2e:testnet` +
          `\n   Get testnet keys at: https://testnet.binance.vision/\n`,
      );
      return;
    }

    const apiKey = process.env.BINANCE_SPOT_API_KEY!;
    const secretKey = process.env.BINANCE_SPOT_SECRET_KEY ?? '';

    handle = buildTestnetAdapter(apiKey, secretKey);

    // adapter.initialize() syncs server time and fetches ExchangeInfo (seeds symbol table)
    const initResult = await handle.adapter.initialize();
    if (initResult.isErr()) {
      console.warn(
        `\n⚠  Binance testnet unreachable — skipping all tests.` +
          `\n   URL: ${TEST_TESTNET_BASE_URL}` +
          `\n   Error: ${initResult.error.message}\n`,
      );
      await handle.cleanup();
      return;
    }

    available = true;
  }, 45_000); // generous timeout for testnet cold start

  afterAll(async () => {
    if (handle) await handle.cleanup();
  });

  function skipIfUnavailable(): boolean {
    if (!available) {
      console.log('  ↷  Testnet unavailable — skipped');
    }
    return !available;
  }

  function skipIfNoSecret(): boolean {
    const missing = !process.env.BINANCE_SPOT_SECRET_KEY;
    if (missing) console.log('  ↷  No secret key — skipped');
    return missing;
  }

  // ── Group 1: Public endpoints (no auth required) ───────────────────────────

  describe('Public endpoints', () => {
    it('ping() returns a non-negative round-trip latency in ms', async () => {
      if (skipIfUnavailable()) return;

      const result = await handle.adapter.ping();

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(result.value).toBeGreaterThanOrEqual(0);
      expect(result.value).toBeLessThan(10_000);
    });

    it('getServerTime() returns a Date within 60 s of local time', async () => {
      if (skipIfUnavailable()) return;

      const before = new Date();
      const result = await handle.adapter.getServerTime();
      const after = new Date();

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      const serverTime = result.value;

      expect(serverTime).toBeInstanceOf(Date);
      // Server time must be within ±60 s of local time
      expect(serverTime.getTime()).toBeGreaterThan(before.getTime() - 60_000);
      expect(serverTime.getTime()).toBeLessThan(after.getTime() + 60_000);
    });

    it('getExchangeInfo() returns metadata that includes BTCUSDT', async () => {
      if (skipIfUnavailable()) return;

      const result = await handle.adapter.getExchangeInfo();

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      const info = result.value;

      expect(info.exchangeId).toBeDefined();
      expect(info.symbols.length).toBeGreaterThan(0);

      const btcUsdt = info.symbols.find((s) => s.symbol === BTCUSDT);
      expect(btcUsdt).toBeDefined();
      expect(btcUsdt!.baseAsset).toBe('BTC');
      expect(btcUsdt!.quoteAsset).toBe('USDT');
      expect(btcUsdt!.isActive).toBe(true);
    });

    it('getTicker() for BTC/USDT returns valid market data', async () => {
      if (skipIfUnavailable()) return;

      const result = await handle.adapter.getTicker(BTCUSDT);

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      const ticker = result.value;

      expect(ticker.symbol).toBe(BTCUSDT);
      expect(ticker.exchangeId).toBeDefined();
      // Price must be positive
      expect(ticker.lastPrice).toBeGreaterThan(0);
      // Bid/ask spread invariant: bid ≤ ask
      expect(ticker.bestBid).toBeGreaterThan(0);
      expect(ticker.bestAsk).toBeGreaterThan(0);
      expect(ticker.bestBid).toBeLessThanOrEqual(ticker.bestAsk);
      // Testnet uses simulated prices — just sanity-check it's positive
      expect(ticker.lastPrice).toBeGreaterThan(1);
    });

    it('getOrderBook() for BTC/USDT returns non-empty bids and asks', async () => {
      if (skipIfUnavailable()) return;

      const result = await handle.adapter.getOrderBook(BTCUSDT, 5);

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      const book = result.value;

      expect(book.symbol).toBe(BTCUSDT);
      expect(book.bids.length).toBeGreaterThan(0);
      expect(book.asks.length).toBeGreaterThan(0);

      // OrderBookLevel has { price, quantity } — NOT tuple [price, quantity]
      const bestBid = book.bids[0]!;
      const bestAsk = book.asks[0]!;
      expect(bestBid.price).toBeGreaterThan(0);
      expect(bestAsk.price).toBeGreaterThan(0);
      // Fundamental invariant: best bid must be below best ask
      expect(bestBid.price).toBeLessThan(bestAsk.price);
      expect(bestBid.quantity).toBeGreaterThan(0);
      expect(bestAsk.quantity).toBeGreaterThan(0);

      // Bids sorted descending, asks sorted ascending
      if (book.bids.length > 1) {
        expect(book.bids[0]!.price).toBeGreaterThanOrEqual(book.bids[1]!.price);
      }
      if (book.asks.length > 1) {
        expect(book.asks[0]!.price).toBeLessThanOrEqual(book.asks[1]!.price);
      }
    });

    it('getRecentTrades() for BTC/USDT returns normalized trade records', async () => {
      if (skipIfUnavailable()) return;

      const result = await handle.adapter.getRecentTrades(BTCUSDT, 10);

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      const trades = result.value;

      expect(trades.length).toBeGreaterThan(0);
      expect(trades.length).toBeLessThanOrEqual(10);

      const trade = trades[0]!;
      expect(trade.symbol).toBe(BTCUSDT);
      expect(trade.price).toBeGreaterThan(0);
      expect(trade.quantity).toBeGreaterThan(0);
      expect(trade.timestamp).toBeInstanceOf(Date);
      // side is an OrderSide enum — verify it's a valid value
      expect([OrderSide.BUY, OrderSide.SELL]).toContain(trade.side);
    });

    it('getSupportedSymbols() returns a non-empty list after initialization', async () => {
      if (skipIfUnavailable()) return;

      const result = await handle.adapter.getSupportedSymbols();

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(result.value.length).toBeGreaterThan(0);
      expect(result.value).toContain(BTCUSDT);
    });
  });

  // ── Group 2: Authenticated endpoints ──────────────────────────────────────

  describe('Authenticated endpoints', () => {
    it('getBalance() returns a balance snapshot with USDT', async () => {
      if (skipIfUnavailable()) return;
      if (skipIfNoSecret()) return;

      const result = await handle.adapter.getBalance();

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      const balance = result.value;

      expect(balance.exchangeId).toBeDefined();
      expect(balance.timestamp).toBeInstanceOf(Date);
      expect(balance.assets).toBeDefined();
      // totalEquity is optional — only present on futures/margin accounts, not spot
      if (balance.totalEquity !== undefined) {
        expect(typeof balance.totalEquity).toBe('number');
      }

      // Testnet accounts always have USDT (funded automatically)
      const usdt = balance.assets['USDT'];
      expect(usdt).toBeDefined();
      expect(typeof usdt!.free).toBe('number');
      expect(typeof usdt!.locked).toBe('number');
      expect(usdt!.free).toBeGreaterThanOrEqual(0);
    });

    it('getAccountInfo() returns a tradeable account', async () => {
      if (skipIfUnavailable()) return;
      if (skipIfNoSecret()) return;

      const result = await handle.adapter.getAccountInfo();

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      const info = result.value;

      expect(info.exchangeId).toBeDefined();
      expect(info.canTrade).toBe(true);
      expect(Array.isArray(info.permissions)).toBe(true);
    });

    it('getOpenOrders() returns an array (may be empty if no pending orders)', async () => {
      if (skipIfUnavailable()) return;
      if (skipIfNoSecret()) return;

      const result = await handle.adapter.getOpenOrders(BTCUSDT);

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      // May be empty or have pre-existing orders — either is valid
      expect(Array.isArray(result.value)).toBe(true);
    });
  });

  // ── Group 3: Rate-limit status ─────────────────────────────────────────────

  describe('Rate-limit metadata', () => {
    it('getRateLimitStatus() returns an array after requests have been made', () => {
      if (skipIfUnavailable()) return;

      const result = handle.adapter.getRateLimitStatus();

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(Array.isArray(result.value)).toBe(true);
    });

    it('isMaintenanceMode() returns false on a live testnet', () => {
      if (skipIfUnavailable()) return;
      // If the testnet is actually in maintenance this test will correctly fail
      expect(handle.adapter.isMaintenanceMode()).toBe(false);
    });
  });
});
