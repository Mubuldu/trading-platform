import { Injectable } from '@nestjs/common';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { NormalizedSymbol } from '@modules/exchange/models/common.model';
import { OrderBook, OrderBookLevel } from '@modules/exchange/models/market.models';
import { BinanceWsDepthMessage } from '../binance-ws.types';

@Injectable()
export class BinanceWsOrderBookMapper {
  /**
   * Maps a Binance depthUpdate WebSocket message to a normalized incremental
   * OrderBook update.
   *
   * Levels with qty "0" signal that the price level should be removed from
   * the local book. Callers must maintain a local book and merge these deltas.
   *
   * isSnapshot = false — this is an incremental update, not a full snapshot.
   * Use the REST adapter's getOrderBook() to seed the initial snapshot.
   */
  map(raw: BinanceWsDepthMessage, symbol: NormalizedSymbol, receivedAt: Date): OrderBook {
    return {
      exchangeId: ExchangeId.BINANCE_SPOT,
      symbol,
      timestamp: new Date(raw.E),
      receivedAt,
      lastUpdateId: raw.u,
      bids: raw.b.map(this.toLevel),
      asks: raw.a.map(this.toLevel),
      depth: Math.max(raw.b.length, raw.a.length),
      isSnapshot: false,
    };
  }

  private toLevel([price, qty]: [string, string]): OrderBookLevel {
    return { price: parseFloat(price), quantity: parseFloat(qty) };
  }
}
