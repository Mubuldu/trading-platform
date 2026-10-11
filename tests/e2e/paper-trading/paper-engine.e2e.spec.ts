/**
 * Paper Trading Engine — end-to-end tests
 *
 * Exercises the complete tick→fill→account pipeline in a single process with
 * no external dependencies (no Docker, no Redis, no real exchange).
 *
 * Architecture under test:
 *   MarketDataEventBus.emit(TICKER_UPDATED, tick)
 *     → PaperOrderBookService.onTick()
 *       → PaperFillEngineService.tryFill*()
 *         → PaperAccountService.applyFill()
 *         → InMemoryPaperStore.appendFill()
 *         → StreamPublisherService.publish()  ← mocked
 *
 * Test scenarios:
 *   1.  Market BUY fills immediately at best ask
 *   2.  Market SELL fills immediately at best bid
 *   3.  Limit BUY fills when ask drops to or below limit
 *   4.  Limit BUY does NOT fill when ask is still above limit
 *   5.  Limit SELL fills when bid rises to or above limit
 *   6.  STOP SELL triggers when bid drops to or below stop price
 *   7.  STOP BUY triggers when ask rises to or above stop price
 *   8.  Trailing STOP SELL: trail follows rising price, triggers on reversal
 *   9.  Cancel limit order restores locked balance
 *   10. Multi-symbol isolation: tick for ETH does not fill BTC limit order
 *   11. Fresh account starts at configured initial balance
 *   12. Commission is deducted from balance on every fill
 *   13. Limit BUY balance is locked on order submission, released on fill
 *   14. getBalance() reflects the live paper account state
 *   15. getOpenOrders() reflects the order book
 *   16. cancelAllOrders() clears all open orders and restores balance
 */

import { ConfigService } from '@nestjs/config';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { StreamPublisherService } from '@infrastructure/redis/streams/stream-publisher.service';
import { MarketDataEventBus } from '@modules/exchange/market-data-event-bus';
import { MARKET_DATA_EVENTS, NormalizedSymbol } from '@modules/exchange/models/common.model';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { OrderSide, OrderStatus, OrderType, TimeInForce } from '@modules/exchange/enums/order.enums';
import { Ticker } from '@modules/exchange/models/market.models';
import { PaperTradingConfig } from '@config/paper-trading.config';
import { PaperExchangeAdapter } from '@modules/paper-trading/infrastructure/adapters/paper-exchange.adapter';
import { PaperFillEngineService } from '@modules/paper-trading/application/services/paper-fill-engine.service';
import { PaperAccountService } from '@modules/paper-trading/application/services/paper-account.service';
import { PaperOrderBookService } from '@modules/paper-trading/application/services/paper-order-book.service';
import { PaperStateStoreService } from '@modules/paper-trading/infrastructure/store/paper-state-store.service';
import {
  PaperAccountState,
  PaperFillRecord,
  PaperPositionState,
} from '@modules/paper-trading/domain/models/paper-account-state.model';
import { PaperOpenOrder } from '@modules/paper-trading/domain/models/paper-open-order.model';
import { SubmitOrderRequest } from '@modules/exchange/models/trading.models';

// ─── In-memory paper state store ─────────────────────────────────────────────

/**
 * Drop-in replacement for PaperStateStoreService that keeps all state in
 * memory. Lets the paper engine run without Redis or Docker.
 */
class InMemoryPaperStore extends PaperStateStoreService {
  private account: PaperAccountState | null = null;
  readonly fills: PaperFillRecord[] = [];
  private readonly positions = new Map<string, PaperPositionState>();
  private readonly openOrders = new Map<string, PaperOpenOrder>();

  // Bypass the RedisClientService requirement in the real constructor
  constructor() {
    super(null as never);
  }

  override async saveAccount(state: PaperAccountState): Promise<void> {
    this.account = { ...state };
  }
  override async loadAccount(): Promise<PaperAccountState | null> {
    return this.account ? { ...this.account } : null;
  }
  override async deleteAccount(): Promise<void> {
    this.account = null;
  }

  override async savePosition(pos: PaperPositionState): Promise<void> {
    this.positions.set(pos.symbol, { ...pos });
  }
  override async loadPosition(symbol: string): Promise<PaperPositionState | null> {
    return this.positions.get(symbol) ?? null;
  }
  override async loadAllPositions(): Promise<PaperPositionState[]> {
    return [...this.positions.values()];
  }
  override async deleteAllPositions(): Promise<void> {
    this.positions.clear();
  }

  override async saveOpenOrder(order: PaperOpenOrder): Promise<void> {
    this.openOrders.set(order.orderId, { ...order });
  }
  override async removeOpenOrder(orderId: string): Promise<void> {
    this.openOrders.delete(orderId);
  }
  override async loadAllOpenOrders(): Promise<PaperOpenOrder[]> {
    return [...this.openOrders.values()];
  }

  override async appendFill(fill: PaperFillRecord): Promise<void> {
    this.fills.push({ ...fill });
  }
  override async loadFills(limit = 500): Promise<PaperFillRecord[]> {
    return this.fills.slice(-limit);
  }

  override async resetAll(): Promise<void> {
    this.account = null;
    this.positions.clear();
    this.openOrders.clear();
    this.fills.length = 0;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const INITIAL_BALANCE = 100_000; // USDT
const MAKER_BPS = 2;
const TAKER_BPS = 5;

const PAPER_CONFIG: PaperTradingConfig = {
  enabled: true,
  initialBalanceUsd: INITIAL_BALANCE,
  resetOnRestart: false,
  simulateSlippage: false, // deterministic prices in tests
  slippageBps: 0,
  simulateLatency: false, // no artificial delay
  latencyMs: 0,
  latencyJitterMs: 0,
  makerCommissionBps: MAKER_BPS,
  takerCommissionBps: TAKER_BPS,
  partialFillEnabled: false, // always fill in full for deterministic tests
  partialFillMinFillPercent: 1,
  fundingEnabled: false,
  fundingIntervalMs: 28_800_000,
  consumerGroup: 'test-paper',
};

/** Minimal ConfigService mock that returns the test paper-trading config. */
function makeMockConfig(): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'paperTrading') return PAPER_CONFIG;
      return undefined;
    },
  } as unknown as ConfigService;
}

/** Silent AppLoggerService mock — keeps test output clean. */
function makeSilentLogger(): AppLoggerService {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    verbose: () => {},
    setContext: () => {},
  } as unknown as AppLoggerService;
}

/** Fake StreamPublisherService — captures publish calls without Redis. */
function makeMockPublisher(): StreamPublisherService {
  return {
    publish: jest.fn().mockResolvedValue(undefined),
  } as unknown as StreamPublisherService;
}

/**
 * Build the complete paper trading stack with in-memory state.
 *
 * Mirrors the real DI wiring inside PaperTradingModule, but substitutes:
 *   - InMemoryPaperStore   for  PaperStateStoreService  (no Redis)
 *   - mockPublisher        for  StreamPublisherService   (no Redis)
 *   - silentLogger         for  AppLoggerService         (no console noise)
 */
interface PaperStack {
  adapter: PaperExchangeAdapter;
  account: PaperAccountService;
  orderBook: PaperOrderBookService;
  fillEngine: PaperFillEngineService;
  store: InMemoryPaperStore;
  bus: MarketDataEventBus;
}

async function buildPaperStack(): Promise<PaperStack> {
  const config = makeMockConfig();
  const logger = makeSilentLogger();
  const store = new InMemoryPaperStore();
  const bus = new MarketDataEventBus();
  const publisher = makeMockPublisher();

  const fillEngine = new PaperFillEngineService(config);
  const account = new PaperAccountService(config, logger, store);
  const orderBook = new PaperOrderBookService(logger, bus, publisher, store, fillEngine, account);
  const adapter = new PaperExchangeAdapter(logger, publisher, store, account, fillEngine, orderBook, bus);

  // adapter.initialize() handles the full sequence:
  //   1. registers adapter's own tickerHandler (latest-price cache)
  //   2. calls account.initialize()  → loads/creates account at INITIAL_BALANCE
  //   3. calls orderBook.initialize() → restores open orders, subscribes fill handler
  // Calling them separately would double-subscribe the order book tick handler.
  await adapter.initialize();

  return { adapter, account, orderBook, fillEngine, store, bus };
}

/**
 * Build a Ticker event with the correct shape for MarketDataEventBus.
 *
 * bestBid and bestAsk default to lastPrice ± 0.5 if not specified.
 */
function makeTick(
  symbol: string,
  lastPrice: number,
  opts: { bestBid?: number; bestAsk?: number } = {},
): Ticker {
  const bid = opts.bestBid ?? lastPrice - 0.5;
  const ask = opts.bestAsk ?? lastPrice + 0.5;
  const now = new Date();
  return {
    exchangeId: ExchangeId.BINANCE_SPOT,
    symbol: NormalizedSymbol.unsafe(symbol),
    timestamp: now,
    receivedAt: now,
    // MarketTick fields
    bestBid: bid,
    bestAsk: ask,
    bestBidQuantity: 1,
    bestAskQuantity: 1,
    spread: ask - bid,
    midPrice: (bid + ask) / 2,
    // Ticker fields
    openPrice: lastPrice,
    highPrice: lastPrice * 1.001,
    lowPrice: lastPrice * 0.999,
    closePrice: lastPrice,
    lastPrice,
    lastQuantity: 0.01,
    volume: 1000,
    quoteVolume: 1000 * lastPrice,
    priceChange: 0,
    priceChangePercent: 0,
    weightedAveragePrice: lastPrice,
    openTime: now,
    closeTime: now,
    tradeCount: 100,
  };
}

/**
 * Emit a tick on the bus and wait for all async handlers to settle.
 *
 * PaperOrderBookService fires `void this.onTick(ticker)` — the promise is
 * untracked by the EventEmitter. We drain two setImmediate cycles to let
 * the in-memory async store operations complete before asserting.
 */
async function emitTick(bus: MarketDataEventBus, tick: Ticker): Promise<void> {
  bus.emit(MARKET_DATA_EVENTS.TICKER_UPDATED, tick);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

/** Taker commission (market/stop orders). */
function takerFee(qty: number, price: number): number {
  return qty * price * (TAKER_BPS / 10_000);
}

/** Maker commission (limit orders). */
function makerFee(qty: number, price: number): number {
  return qty * price * (MAKER_BPS / 10_000);
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Paper Trading Engine — end-to-end', () => {
  const BTC = 'BTC/USDT';
  const ETH = 'ETH/USDT';
  const BTCUSDT = NormalizedSymbol.unsafe(BTC);
  const ETHUSDT = NormalizedSymbol.unsafe(ETH);

  // Each test gets a fresh stack — no state leaks between scenarios.
  let s: PaperStack;

  beforeEach(async () => {
    s = await buildPaperStack();
  });

  afterEach(async () => {
    await s.adapter.destroy();
  });

  // ── Scenario 1: Market BUY ──────────────────────────────────────────────────

  it('market BUY fills immediately at best ask and deducts balance', async () => {
    // Seed the adapter's latestPrices map by emitting a tick first
    await emitTick(s.bus, makeTick(BTC, 50_000, { bestBid: 49_999, bestAsk: 50_001 }));

    const initialBalance = s.account.getAvailableBalance();
    const qty = 0.1;
    const expectedFillPrice = 50_001; // slippage=0 → bestAsk
    const expectedCost = qty * expectedFillPrice;
    const expectedFee = takerFee(qty, expectedFillPrice);

    const req: SubmitOrderRequest = {
      symbol: BTCUSDT,
      side: OrderSide.BUY,
      type: OrderType.MARKET,
      quantity: qty,
    };

    const result = await s.adapter.submitOrder(req);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    const order = result.value;

    expect(order.status).toBe(OrderStatus.FILLED);
    expect(order.executedQuantity).toBeCloseTo(qty);
    expect(order.averagePrice).toBeCloseTo(expectedFillPrice);

    // Fill record saved to store
    expect(s.store.fills).toHaveLength(1);
    expect(s.store.fills[0]!.filledQuantity).toBeCloseTo(qty);
    expect(s.store.fills[0]!.fillPrice).toBeCloseTo(expectedFillPrice);
    expect(s.store.fills[0]!.isMaker).toBe(false);

    // Balance reduced by cost + commission
    const newBalance = s.account.getAvailableBalance();
    expect(newBalance).toBeCloseTo(initialBalance - expectedCost - expectedFee, 2);
  });

  // ── Scenario 2: Market SELL ─────────────────────────────────────────────────

  it('market SELL fills immediately at best bid and credits balance', async () => {
    // Seed latest price
    await emitTick(s.bus, makeTick(BTC, 50_000, { bestBid: 49_999, bestAsk: 50_001 }));

    // Buy some BTC so there's something to sell
    await s.adapter.submitOrder({
      symbol: BTCUSDT,
      side: OrderSide.BUY,
      type: OrderType.MARKET,
      quantity: 0.5,
    });

    const balanceAfterBuy = s.account.getAvailableBalance();
    const qty = 0.1;
    const expectedFillPrice = 49_999; // slippage=0 → bestBid
    const proceeds = qty * expectedFillPrice;
    const fee = takerFee(qty, expectedFillPrice);

    const result = await s.adapter.submitOrder({
      symbol: BTCUSDT,
      side: OrderSide.SELL,
      type: OrderType.MARKET,
      quantity: qty,
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.status).toBe(OrderStatus.FILLED);
    expect(result.value.averagePrice).toBeCloseTo(expectedFillPrice);

    const newBalance = s.account.getAvailableBalance();
    expect(newBalance).toBeCloseTo(balanceAfterBuy + proceeds - fee, 2);
  });

  // ── Scenario 3: Limit BUY fills on price drop ───────────────────────────────

  it('limit BUY fills when best ask drops to or below limit price', async () => {
    const limitPrice = 49_000;
    const qty = 0.2;

    const result = await s.adapter.submitOrder({
      symbol: BTCUSDT,
      side: OrderSide.BUY,
      type: OrderType.LIMIT,
      quantity: qty,
      price: limitPrice,
      timeInForce: TimeInForce.GTC,
    });

    // Accepted as NEW (not yet filled)
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.status).toBe(OrderStatus.NEW);

    // Ask still above limit → no fill
    await emitTick(s.bus, makeTick(BTC, 49_100, { bestBid: 49_099, bestAsk: 49_100 }));
    expect(s.store.fills).toHaveLength(0);

    // Ask drops to limit → fills
    await emitTick(s.bus, makeTick(BTC, 49_000, { bestBid: 48_999, bestAsk: 49_000 }));

    expect(s.store.fills).toHaveLength(1);
    const fill = s.store.fills[0]!;
    expect(fill.fillPrice).toBeCloseTo(limitPrice); // maker fills at exact limit price
    expect(fill.filledQuantity).toBeCloseTo(qty);
    expect(fill.isMaker).toBe(true);

    // Order removed from open book
    expect(s.orderBook.getOpenOrders(BTCUSDT)).toHaveLength(0);
  });

  // ── Scenario 4: Limit BUY does NOT fill when ask > limit ───────────────────

  it('limit BUY remains open when ask stays above limit price', async () => {
    const limitPrice = 48_000;
    const qty = 0.1;

    await s.adapter.submitOrder({
      symbol: BTCUSDT,
      side: OrderSide.BUY,
      type: OrderType.LIMIT,
      quantity: qty,
      price: limitPrice,
      timeInForce: TimeInForce.GTC,
    });

    // Multiple ticks above the limit
    await emitTick(s.bus, makeTick(BTC, 50_000, { bestBid: 49_999, bestAsk: 50_001 }));
    await emitTick(s.bus, makeTick(BTC, 49_500, { bestBid: 49_499, bestAsk: 49_501 }));
    await emitTick(s.bus, makeTick(BTC, 48_100, { bestBid: 48_099, bestAsk: 48_100 }));

    // Ask still above 48_000 → no fill
    expect(s.store.fills).toHaveLength(0);
    expect(s.orderBook.getOpenOrders(BTCUSDT)).toHaveLength(1);
  });

  // ── Scenario 5: Limit SELL fills on price rise ──────────────────────────────

  it('limit SELL fills when best bid rises to or above limit price', async () => {
    const limitPrice = 51_000;
    const qty = 0.15;

    await s.adapter.submitOrder({
      symbol: BTCUSDT,
      side: OrderSide.SELL,
      type: OrderType.LIMIT,
      quantity: qty,
      price: limitPrice,
      timeInForce: TimeInForce.GTC,
    });

    // Bid below limit → no fill
    await emitTick(s.bus, makeTick(BTC, 50_500, { bestBid: 50_499, bestAsk: 50_501 }));
    expect(s.store.fills).toHaveLength(0);

    // Bid rises to limit → fills
    await emitTick(s.bus, makeTick(BTC, 51_000, { bestBid: 51_001, bestAsk: 51_002 }));

    expect(s.store.fills).toHaveLength(1);
    const fill = s.store.fills[0]!;
    expect(fill.fillPrice).toBeCloseTo(limitPrice);
    expect(fill.filledQuantity).toBeCloseTo(qty);
    expect(fill.isMaker).toBe(true);
    expect(fill.side).toBe(OrderSide.SELL);
  });

  // ── Scenario 6: STOP SELL triggers on price drop ───────────────────────────

  it('STOP SELL triggers when best bid drops to or below stop price', async () => {
    const stopPrice = 48_000;
    const qty = 0.1;

    await s.adapter.submitOrder({
      symbol: BTCUSDT,
      side: OrderSide.SELL,
      type: OrderType.STOP,
      quantity: qty,
      stopPrice,
      timeInForce: TimeInForce.GTC,
    });

    // Price above stop → no trigger
    await emitTick(s.bus, makeTick(BTC, 49_000, { bestBid: 48_999, bestAsk: 49_001 }));
    expect(s.store.fills).toHaveLength(0);

    // Price drops to stop → triggers as market sell (taker)
    await emitTick(s.bus, makeTick(BTC, 47_999, { bestBid: 47_999, bestAsk: 48_001 }));

    expect(s.store.fills).toHaveLength(1);
    const fill = s.store.fills[0]!;
    expect(fill.isMaker).toBe(false);
    expect(fill.filledQuantity).toBeCloseTo(qty);
    expect(fill.side).toBe(OrderSide.SELL);
  });

  // ── Scenario 7: STOP BUY triggers on price rise ─────────────────────────────

  it('STOP BUY triggers when best ask rises to or above stop price', async () => {
    const stopPrice = 52_000;
    const qty = 0.05;

    await s.adapter.submitOrder({
      symbol: BTCUSDT,
      side: OrderSide.BUY,
      type: OrderType.STOP,
      quantity: qty,
      stopPrice,
      timeInForce: TimeInForce.GTC,
    });

    // Ask below stop → no trigger
    await emitTick(s.bus, makeTick(BTC, 51_500, { bestBid: 51_499, bestAsk: 51_501 }));
    expect(s.store.fills).toHaveLength(0);

    // Ask rises to stop → triggers
    await emitTick(s.bus, makeTick(BTC, 52_001, { bestBid: 52_000, bestAsk: 52_001 }));

    expect(s.store.fills).toHaveLength(1);
    expect(s.store.fills[0]!.side).toBe(OrderSide.BUY);
    expect(s.store.fills[0]!.filledQuantity).toBeCloseTo(qty);
  });

  // ── Scenario 8: Trailing STOP SELL ──────────────────────────────────────────

  it('trailing STOP SELL follows the rising peak and triggers on reversal', async () => {
    const trailingDeltaBps = 200; // 2% trail below the high
    const qty = 0.1;

    await s.adapter.submitOrder({
      symbol: BTCUSDT,
      side: OrderSide.SELL,
      type: OrderType.TRAILING_STOP,
      quantity: qty,
      trailingDelta: trailingDeltaBps,
      timeInForce: TimeInForce.GTC,
    });

    // Price rises — trail peak moves up, stop follows
    await emitTick(s.bus, makeTick(BTC, 50_000, { bestBid: 49_999, bestAsk: 50_001 }));
    await emitTick(s.bus, makeTick(BTC, 52_000, { bestBid: 51_999, bestAsk: 52_001 }));
    await emitTick(s.bus, makeTick(BTC, 54_000, { bestBid: 53_999, bestAsk: 54_001 }));
    // peak = 54_000, trail stop = 54_000 × (1 − 0.02) = 52_920

    // Still not triggered (bid = 53_999 > stop 52_920)
    expect(s.store.fills).toHaveLength(0);

    // Price reverses — bid drops below trail stop
    await emitTick(s.bus, makeTick(BTC, 52_900, { bestBid: 52_899, bestAsk: 52_901 }));

    expect(s.store.fills).toHaveLength(1);
    const fill = s.store.fills[0]!;
    expect(fill.side).toBe(OrderSide.SELL);
    expect(fill.filledQuantity).toBeCloseTo(qty);
    expect(fill.isMaker).toBe(false); // trailing stop is always a taker
  });

  // ── Scenario 9: Cancel restores locked balance ──────────────────────────────

  it('cancelling a limit BUY restores the locked balance to available', async () => {
    const limitPrice = 49_000;
    const qty = 1.0;
    const lockAmount = qty * limitPrice; // 49_000 USDT

    const balanceBefore = s.account.getAvailableBalance();

    const submitResult = await s.adapter.submitOrder({
      symbol: BTCUSDT,
      side: OrderSide.BUY,
      type: OrderType.LIMIT,
      quantity: qty,
      price: limitPrice,
      timeInForce: TimeInForce.GTC,
    });

    expect(submitResult.isOk()).toBe(true);
    if (!submitResult.isOk()) return;

    // Balance reduced by the locked amount
    expect(s.account.getAvailableBalance()).toBeCloseTo(balanceBefore - lockAmount, 2);

    const cancelResult = await s.adapter.cancelOrder({
      symbol: BTCUSDT,
      exchangeOrderId: submitResult.value.exchangeOrderId,
    });

    expect(cancelResult.isOk()).toBe(true);
    if (!cancelResult.isOk()) return;
    expect(cancelResult.value.status).toBe(OrderStatus.CANCELLED);

    // Balance fully restored
    expect(s.account.getAvailableBalance()).toBeCloseTo(balanceBefore, 2);
    expect(s.orderBook.getOpenOrders(BTCUSDT)).toHaveLength(0);
    expect(s.store.fills).toHaveLength(0);
  });

  // ── Scenario 10: Multi-symbol isolation ─────────────────────────────────────

  it('tick for ETH/USDT does not fill a BTC/USDT limit order', async () => {
    const limitPrice = 49_000;

    await s.adapter.submitOrder({
      symbol: BTCUSDT,
      side: OrderSide.BUY,
      type: OrderType.LIMIT,
      quantity: 0.1,
      price: limitPrice,
      timeInForce: TimeInForce.GTC,
    });

    // Cheap ETH tick — price looks like a crossing but wrong symbol
    await emitTick(s.bus, makeTick(ETH, limitPrice - 500, { bestBid: 48_400, bestAsk: 48_500 }));

    expect(s.store.fills).toHaveLength(0);
    expect(s.orderBook.getOpenOrders(BTCUSDT)).toHaveLength(1);
    expect(s.orderBook.getOpenOrders(ETHUSDT)).toHaveLength(0);
  });

  // ── Scenario 11: Initial balance ─────────────────────────────────────────────

  it('fresh account starts at the configured initial balance', () => {
    expect(s.account.getAvailableBalance()).toBe(INITIAL_BALANCE);
  });

  // ── Scenario 12: Commission deducted on every fill ───────────────────────────

  it('taker commission is deducted from balance on a market order fill', async () => {
    await emitTick(s.bus, makeTick(BTC, 50_000, { bestBid: 49_999, bestAsk: 50_001 }));

    const before = s.account.getAvailableBalance();
    const qty = 0.5;
    const fillPrice = 50_001;

    await s.adapter.submitOrder({
      symbol: BTCUSDT,
      side: OrderSide.BUY,
      type: OrderType.MARKET,
      quantity: qty,
    });

    const cost = qty * fillPrice;
    const fee = takerFee(qty, fillPrice);
    const after = s.account.getAvailableBalance();

    expect(after).toBeCloseTo(before - cost - fee, 4);
    expect(s.store.fills[0]!.commission).toBeCloseTo(fee, 6);
  });

  // ── Scenario 13: Balance lock on limit BUY ──────────────────────────────────

  it('submitting a limit BUY immediately locks the required quote balance', async () => {
    const limitPrice = 49_500;
    const qty = 0.5;
    const expectedLock = qty * limitPrice;

    const before = s.account.getAvailableBalance();

    await s.adapter.submitOrder({
      symbol: BTCUSDT,
      side: OrderSide.BUY,
      type: OrderType.LIMIT,
      quantity: qty,
      price: limitPrice,
      timeInForce: TimeInForce.GTC,
    });

    expect(s.account.getAvailableBalance()).toBeCloseTo(before - expectedLock, 2);

    // Emit a tick that crosses the limit → fill consumes the locked balance + adds fee
    await emitTick(s.bus, makeTick(BTC, limitPrice, { bestBid: limitPrice - 1, bestAsk: limitPrice }));

    expect(s.store.fills).toHaveLength(1);
    const fill = s.store.fills[0]!;
    expect(fill.filledQuantity).toBeCloseTo(qty);
    expect(fill.fillPrice).toBeCloseTo(limitPrice);
    const makerFeeAmount = makerFee(qty, limitPrice);
    expect(s.account.getAvailableBalance()).toBeCloseTo(before - expectedLock - makerFeeAmount, 2);
  });

  // ── Scenario 14: getBalance() reflects paper account state ──────────────────

  it('getBalance() returns the live paper account balance', async () => {
    const balanceResult = await s.adapter.getBalance();

    expect(balanceResult.isOk()).toBe(true);
    if (!balanceResult.isOk()) return;
    const balance = balanceResult.value;

    expect(balance.exchangeId).toBe(ExchangeId.PAPER_TRADING);
    expect(balance.assets['USDT']).toBeDefined();
    expect(balance.assets['USDT']!.free).toBeCloseTo(INITIAL_BALANCE, 2);
    expect(balance.availableBalance).toBeCloseTo(INITIAL_BALANCE, 2);
  });

  // ── Scenario 15: getOpenOrders() reflects the order book ────────────────────

  it('getOpenOrders() returns all pending limit orders for the symbol', async () => {
    await s.adapter.submitOrder({
      symbol: BTCUSDT,
      side: OrderSide.BUY,
      type: OrderType.LIMIT,
      quantity: 0.1,
      price: 48_000,
      timeInForce: TimeInForce.GTC,
    });
    await s.adapter.submitOrder({
      symbol: BTCUSDT,
      side: OrderSide.BUY,
      type: OrderType.LIMIT,
      quantity: 0.2,
      price: 47_500,
      timeInForce: TimeInForce.GTC,
    });

    const openResult = await s.adapter.getOpenOrders(BTCUSDT);
    expect(openResult.isOk()).toBe(true);
    if (!openResult.isOk()) return;
    expect(openResult.value).toHaveLength(2);
  });

  // ── Scenario 16: cancelAllOrders() clears all open orders ───────────────────

  it('cancelAllOrders() removes all pending orders and restores balance', async () => {
    const lp1 = 48_000;
    const lp2 = 47_500;
    const qty1 = 0.1;
    const qty2 = 0.2;
    const totalLock = qty1 * lp1 + qty2 * lp2;
    const before = s.account.getAvailableBalance();

    await s.adapter.submitOrder({
      symbol: BTCUSDT,
      side: OrderSide.BUY,
      type: OrderType.LIMIT,
      quantity: qty1,
      price: lp1,
      timeInForce: TimeInForce.GTC,
    });
    await s.adapter.submitOrder({
      symbol: BTCUSDT,
      side: OrderSide.BUY,
      type: OrderType.LIMIT,
      quantity: qty2,
      price: lp2,
      timeInForce: TimeInForce.GTC,
    });

    expect(s.account.getAvailableBalance()).toBeCloseTo(before - totalLock, 2);

    const cancelResult = await s.adapter.cancelAllOrders(BTCUSDT);
    expect(cancelResult.isOk()).toBe(true);
    if (!cancelResult.isOk()) return;
    expect(cancelResult.value).toHaveLength(2);

    // All balance restored
    expect(s.account.getAvailableBalance()).toBeCloseTo(before, 2);
    expect(s.orderBook.getOpenOrders(BTCUSDT)).toHaveLength(0);
  });
});
