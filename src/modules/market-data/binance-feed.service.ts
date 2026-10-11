import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import WebSocket = require('ws');
import { AppLoggerService } from '@core/logging/app-logger.service';
import { StreamPublisherService } from '@infrastructure/redis/streams/stream-publisher.service';
import { STREAM_NAMES, StreamName } from '@infrastructure/redis/streams/stream-names.constants';
import { MarketDataEventBus } from '@modules/exchange/market-data-event-bus';
import { MARKET_DATA_EVENTS, NormalizedSymbol } from '@modules/exchange/models/common.model';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { Ticker } from '@modules/exchange/models/market.models';

/**
 * Pairs to subscribe to: [Binance exchange symbol, normalized symbol].
 * Add more pairs here to receive real-time data for additional assets.
 */
const FEED_PAIRS: Array<[string, string]> = [
  ['BTCUSDT', 'BTC/USDT'],
  ['ETHUSDT', 'ETH/USDT'],
  ['SOLUSDT', 'SOL/USDT'],
];

const KLINE_INTERVALS = ['1m', '5m', '15m', '1h'];

const WS_BASE_URL = 'wss://stream.binance.com:9443/stream?streams=';

/** How long to wait before attempting a reconnect after a close/error. */
const RECONNECT_DELAY_MS = 5_000;

const CONTEXT = 'BinanceFeedService';

/**
 * BinanceFeedService — self-contained Binance public WebSocket feed.
 *
 * Subscribes to the Binance Combined Stream endpoint (no API key required)
 * for 24hrTicker + kline_1m/5m/15m/1h on each configured pair.
 *
 * On every ticker frame it emits a TICKER_UPDATED event on MarketDataEventBus
 * so that PaperExchangeAdapter can fill MARKET orders with a real price.
 *
 * On every closed kline it publishes to the matching Redis stream
 * (market:kline:1m / 5m / 15m / 1h) so KlineConsumerService feeds
 * live candles to the indicator pipeline.
 *
 * Reconnects automatically on close or error with a fixed 5-second delay.
 */
@Injectable()
export class BinanceFeedService implements OnModuleInit, OnModuleDestroy {
  private ws: InstanceType<typeof WebSocket> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  /** Maps Binance exchange symbol (e.g. 'BTCUSDT') → NormalizedSymbol ('BTC/USDT'). */
  private readonly symbolMap = new Map<string, NormalizedSymbol>(
    FEED_PAIRS.map(([ex, norm]) => [ex, NormalizedSymbol.unsafe(norm)]),
  );

  constructor(
    private readonly eventBus: MarketDataEventBus,
    private readonly publisher: StreamPublisherService,
    private readonly logger: AppLoggerService,
  ) {}

  onModuleInit(): void {
    this.connect();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.terminate();
      this.ws = null;
    }
    this.logger.log('Binance feed disconnected (module destroy)', CONTEXT);
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private buildUrl(): string {
    const streams: string[] = [];
    for (const [ex] of FEED_PAIRS) {
      const lower = ex.toLowerCase();
      streams.push(`${lower}@ticker`);
      for (const interval of KLINE_INTERVALS) {
        streams.push(`${lower}@kline_${interval}`);
      }
    }
    return `${WS_BASE_URL}${streams.join('/')}`;
  }

  private connect(): void {
    if (this.stopped) return;

    const url = this.buildUrl();
    this.logger.log(
      `Connecting to Binance WS feed — ${FEED_PAIRS.length} pairs × ${KLINE_INTERVALS.length} kline intervals`,
      CONTEXT,
    );

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on('open', () => {
      this.logger.log(
        `Binance WS feed connected — pairs: ${FEED_PAIRS.map(([, n]) => n).join(', ')}`,
        CONTEXT,
      );
    });

    ws.on('message', (data: WebSocket.RawData) => {
      const raw = typeof data === 'string' ? data : (data as Buffer).toString('utf-8');
      this.handleMessage(raw);
    });

    ws.on('close', (code: number) => {
      this.ws = null;
      if (!this.stopped) {
        this.logger.warn(
          `Binance WS feed closed (code=${code}) — reconnecting in ${RECONNECT_DELAY_MS / 1_000}s`,
          CONTEXT,
        );
        this.scheduleReconnect();
      }
    });

    ws.on('error', (error: Error) => {
      this.logger.error(`Binance WS feed error: ${error.message}`, undefined, CONTEXT);
      // 'close' fires after 'error' in the ws library, so reconnect is handled there.
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_DELAY_MS);
  }

  private handleMessage(raw: string): void {
    let envelope: { stream?: string; data?: unknown };
    try {
      envelope = JSON.parse(raw) as { stream?: string; data?: unknown };
    } catch {
      return;
    }

    if (!envelope.stream || !envelope.data) return;

    const data = envelope.data as Record<string, unknown>;
    const event = data.e as string | undefined;

    if (event === '24hrTicker') {
      this.handleTicker(data);
    } else if (event === 'kline') {
      void this.handleKline(data);
    }
  }

  private handleTicker(data: Record<string, unknown>): void {
    const symbol = this.symbolMap.get(data.s as string);
    if (!symbol) return;

    const bid = parseFloat(data.b as string);
    const ask = parseFloat(data.a as string);
    const last = parseFloat(data.c as string);

    const ticker: Ticker = {
      exchangeId: ExchangeId.BINANCE_SPOT,
      symbol,
      timestamp: new Date(data.E as number),
      receivedAt: new Date(),
      bestBid: bid,
      bestAsk: ask,
      bestBidQuantity: parseFloat((data.B as string) ?? '0') || 0,
      bestAskQuantity: parseFloat((data.A as string) ?? '0') || 0,
      spread: ask - bid,
      midPrice: (bid + ask) / 2,
      openPrice: parseFloat(data.o as string),
      highPrice: parseFloat(data.h as string),
      lowPrice: parseFloat(data.l as string),
      closePrice: last,
      lastPrice: last,
      lastQuantity: parseFloat((data.Q as string) ?? '0') || 0,
      volume: parseFloat(data.v as string),
      quoteVolume: parseFloat(data.q as string),
      priceChange: parseFloat(data.p as string),
      priceChangePercent: parseFloat(data.P as string),
      weightedAveragePrice: parseFloat((data.w as string) ?? '0') || (bid + ask) / 2,
      openTime: new Date(data.O as number),
      closeTime: new Date(data.C as number),
      tradeCount: (data.n as number) ?? 0,
    };

    this.eventBus.emit(MARKET_DATA_EVENTS.TICKER_UPDATED, ticker);
  }

  private async handleKline(data: Record<string, unknown>): Promise<void> {
    const k = data.k as Record<string, unknown>;
    const symbol = this.symbolMap.get(k.s as string);
    if (!symbol) return;

    const streamName = this.intervalToStream(k.i as string);
    if (!streamName) return;

    const isClosed = k.x as boolean;

    // Log closed candles at INFO so we can confirm the pipeline is alive.
    // Open-candle updates fire every second — log those at DEBUG only.
    if (isClosed) {
      this.logger.log(
        `[KLINE-CLOSED] ${String(symbol)} ${k.i as string} close=${k.c as string} → publishing to Redis`,
        CONTEXT,
      );
    }

    try {
      await this.publisher.publish(streamName, {
        correlationId: randomUUID(),
        eventType: 'KlineUpdated',
        exchange: ExchangeId.BINANCE_SPOT,
        symbol,
        timestamp: Date.now(),
        producer: CONTEXT,
        payload: {
          openTime: k.t,
          closeTime: k.T,
          open: k.o,
          high: k.h,
          low: k.l,
          close: k.c,
          volume: k.v,
          isClosed,
        },
      });

      if (isClosed) {
        this.logger.log(
          `[KLINE-CLOSED] ${String(symbol)} ${k.i as string} published OK → stream consumer should pick this up`,
          CONTEXT,
        );
      }
    } catch (error) {
      this.logger.warn(
        `[KLINE-CLOSED] publish FAILED for ${String(symbol)} ${k.i as string}: ${(error as Error).message}`,
        CONTEXT,
      );
    }
  }

  private intervalToStream(interval: string): StreamName | null {
    const map: Record<string, StreamName> = {
      '1m': STREAM_NAMES.MARKET_KLINE_1M,
      '5m': STREAM_NAMES.MARKET_KLINE_5M,
      '15m': STREAM_NAMES.MARKET_KLINE_15M,
      '1h': STREAM_NAMES.MARKET_KLINE_1H,
    };
    return map[interval] ?? null;
  }
}
