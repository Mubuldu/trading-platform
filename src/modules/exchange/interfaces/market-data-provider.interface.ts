import { Result } from '@common/result';
import { ExchangeId } from '../enums/exchange.enums';
import { NormalizedSymbol, MarketDataSubscription } from '../models/common.model';
import { Ticker, OrderBook, Trade, FundingRate } from '../models/market.models';
import { SymbolInfo } from '../models/exchange.models';
import { ExchangeError } from '../errors/exchange.error';

export type OrderBookDepth = 5 | 10 | 20 | 50 | 100 | 500 | 1000;

/**
 * MarketDataProvider supplies both streaming (WebSocket) and snapshot (REST)
 * market data from an exchange.
 *
 * Streaming methods (subscribe*) establish a WebSocket connection and publish
 * normalized events to the internal EventBus using the event types in
 * MARKET_DATA_EVENTS. The returned MarketDataSubscription holds the handle
 * to cancel the subscription and stop publishing.
 *
 * Snapshot methods (get*) make one-shot REST requests and return immediately.
 *
 * Consumers should prefer streaming for latency-sensitive operations (signal
 * generation) and snapshots for initialization (loading the current order book
 * when a strategy starts).
 */
export interface MarketDataProvider {
  readonly exchangeId: ExchangeId;

  // ── Connection ───────────────────────────────────────────────────────────
  connect(): Promise<Result<void, ExchangeError>>;
  disconnect(): Promise<Result<void, ExchangeError>>;
  isConnected(): boolean;
  ping(): Promise<Result<number, ExchangeError>>;
  getServerTime(): Promise<Result<Date, ExchangeError>>;

  // ── Streaming subscriptions ───────────────────────────────────────────────
  subscribeToTicker(
    symbol: NormalizedSymbol,
  ): Promise<Result<MarketDataSubscription, ExchangeError>>;
  subscribeToOrderBook(
    symbol: NormalizedSymbol,
    depth?: OrderBookDepth,
  ): Promise<Result<MarketDataSubscription, ExchangeError>>;
  subscribeToTrades(
    symbol: NormalizedSymbol,
  ): Promise<Result<MarketDataSubscription, ExchangeError>>;
  subscribeToFundingRate(
    symbol: NormalizedSymbol,
  ): Promise<Result<MarketDataSubscription, ExchangeError>>;
  subscribeToMarkPrice(
    symbol: NormalizedSymbol,
  ): Promise<Result<MarketDataSubscription, ExchangeError>>;
  unsubscribeAll(): Promise<void>;

  // ── Snapshots (REST) ──────────────────────────────────────────────────────
  getTicker(symbol: NormalizedSymbol): Promise<Result<Ticker, ExchangeError>>;
  getOrderBook(
    symbol: NormalizedSymbol,
    depth?: OrderBookDepth,
  ): Promise<Result<OrderBook, ExchangeError>>;
  getRecentTrades(
    symbol: NormalizedSymbol,
    limit?: number,
  ): Promise<Result<Trade[], ExchangeError>>;
  getFundingRate(symbol: NormalizedSymbol): Promise<Result<FundingRate, ExchangeError>>;

  // ── Discovery ─────────────────────────────────────────────────────────────
  getSupportedSymbols(): Promise<Result<NormalizedSymbol[], ExchangeError>>;
  getSymbolInfo(symbol: NormalizedSymbol): Promise<Result<SymbolInfo, ExchangeError>>;
}
