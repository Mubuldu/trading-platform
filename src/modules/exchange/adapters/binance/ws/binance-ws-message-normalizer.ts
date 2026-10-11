import { Injectable } from '@nestjs/common';
import { MARKET_DATA_EVENTS, NormalizedSymbol } from '@modules/exchange/models/common.model';
import { Ticker, OrderBook, Trade } from '@modules/exchange/models/market.models';
import { SymbolNormalizer } from '@modules/exchange/normalizers/symbol.normalizer';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import {
  BinanceWsTickerMessage,
  BinanceWsAggTradeMessage,
  BinanceWsDepthMessage,
} from './binance-ws.types';
import { BINANCE_WS_EVENT } from './binance-ws.constants';
import { BinanceWsTickerMapper } from './mappers/binance-ws-ticker.mapper';
import { BinanceWsOrderBookMapper } from './mappers/binance-ws-order-book.mapper';
import { BinanceWsTradeMapper } from './mappers/binance-ws-trade.mapper';

/** The result of normalizing one raw WebSocket message. */
export interface NormalizedWsMessage {
  /** MARKET_DATA_EVENTS constant — used to publish to MarketDataEventBus. */
  readonly eventType: string;
  /** Normalized payload (Ticker | Trade | OrderBook). */
  readonly payload: Ticker | Trade | OrderBook;
  /** Exchange event timestamp for latency tracking. */
  readonly exchangeTimestampMs: number;
  /** For sequence validation on depth streams (Binance `u` field). */
  readonly updateId?: number;
  /** For sequence validation on depth streams (Binance `U` field). */
  readonly firstUpdateId?: number;
  /** Normalized symbol resolved from the exchange symbol. */
  readonly symbol: NormalizedSymbol;
}

/**
 * BinanceWsMessageNormalizer dispatches incoming stream messages to the
 * appropriate WS mapper based on the event type (`e` field).
 *
 * The stream ID (e.g. "btcusdt@ticker") is used to resolve the exchange
 * symbol before passing to the mapper.
 *
 * Returns null for unrecognized or malformed messages — callers must handle
 * null gracefully (skip silently, optionally log at debug level).
 */
@Injectable()
export class BinanceWsMessageNormalizer {
  constructor(
    private readonly symbolNormalizer: SymbolNormalizer,
    private readonly tickerMapper: BinanceWsTickerMapper,
    private readonly orderBookMapper: BinanceWsOrderBookMapper,
    private readonly tradeMapper: BinanceWsTradeMapper,
  ) {}

  normalize(streamId: string, data: unknown, receivedAt: Date): NormalizedWsMessage | null {
    if (typeof data !== 'object' || data === null) return null;

    const event = (data as { e?: string }).e;

    switch (event) {
      case BINANCE_WS_EVENT.TICKER:
        return this.normalizeTicker(data as BinanceWsTickerMessage, receivedAt);

      case BINANCE_WS_EVENT.AGG_TRADE:
        return this.normalizeTrade(data as BinanceWsAggTradeMessage, receivedAt);

      case BINANCE_WS_EVENT.DEPTH_UPDATE:
        return this.normalizeDepth(data as BinanceWsDepthMessage, receivedAt);

      default:
        return this.normalizeByStreamId(streamId, data, receivedAt);
    }
  }

  private normalizeTicker(
    raw: BinanceWsTickerMessage,
    receivedAt: Date,
  ): NormalizedWsMessage | null {
    const symbol = this.resolveSymbol(raw.s);
    if (!symbol) return null;

    const ticker = this.tickerMapper.map(raw, symbol, receivedAt);
    return {
      eventType: MARKET_DATA_EVENTS.TICKER_UPDATED,
      payload: ticker,
      exchangeTimestampMs: raw.E,
      symbol,
    };
  }

  private normalizeTrade(
    raw: BinanceWsAggTradeMessage,
    receivedAt: Date,
  ): NormalizedWsMessage | null {
    const symbol = this.resolveSymbol(raw.s);
    if (!symbol) return null;

    const trade = this.tradeMapper.map(raw, symbol, receivedAt);
    return {
      eventType: MARKET_DATA_EVENTS.TRADE_EXECUTED,
      payload: trade,
      exchangeTimestampMs: raw.E,
      updateId: raw.a,
      symbol,
    };
  }

  private normalizeDepth(raw: BinanceWsDepthMessage, receivedAt: Date): NormalizedWsMessage | null {
    const symbol = this.resolveSymbol(raw.s);
    if (!symbol) return null;

    const orderBook = this.orderBookMapper.map(raw, symbol, receivedAt);
    return {
      eventType: MARKET_DATA_EVENTS.ORDER_BOOK_UPDATED,
      payload: orderBook,
      exchangeTimestampMs: raw.E,
      updateId: raw.u,
      firstUpdateId: raw.U,
      symbol,
    };
  }

  /**
   * Fallback for streams that don't include an `e` field (e.g. partial depth
   * snapshots — btcusdt@depth20@100ms). Currently not mapped; returns null.
   */
  private normalizeByStreamId(
    _streamId: string,
    _data: unknown,
    _receivedAt: Date,
  ): NormalizedWsMessage | null {
    return null;
  }

  /** Resolve Binance exchange symbol (e.g. "BTCUSDT") to NormalizedSymbol. */
  private resolveSymbol(exchangeSymbol: string): NormalizedSymbol | null {
    const result = this.symbolNormalizer.normalize(exchangeSymbol, ExchangeId.BINANCE_SPOT);
    return result.isOk() ? result.value : null;
  }
}
