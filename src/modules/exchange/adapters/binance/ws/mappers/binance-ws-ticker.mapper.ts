import { Injectable } from '@nestjs/common';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { NormalizedSymbol } from '@modules/exchange/models/common.model';
import { Ticker } from '@modules/exchange/models/market.models';
import { BinanceWsTickerMessage } from '../binance-ws.types';

@Injectable()
export class BinanceWsTickerMapper {
  /** Maps a Binance 24hrTicker WebSocket payload to a normalized Ticker. */
  map(raw: BinanceWsTickerMessage, symbol: NormalizedSymbol, receivedAt: Date): Ticker {
    const lastPrice = parseFloat(raw.c);
    const bestBid = parseFloat(raw.b);
    const bestAsk = parseFloat(raw.a);

    return {
      exchangeId: ExchangeId.BINANCE_SPOT,
      symbol,
      timestamp: new Date(raw.E),
      receivedAt,

      // MarketTick fields
      bestBid,
      bestAsk,
      bestBidQuantity: parseFloat(raw.B),
      bestAskQuantity: parseFloat(raw.A),
      spread: bestAsk - bestBid,
      midPrice: (bestBid + bestAsk) / 2,

      // Ticker-specific fields
      openPrice: parseFloat(raw.o),
      highPrice: parseFloat(raw.h),
      lowPrice: parseFloat(raw.l),
      closePrice: lastPrice,
      lastPrice,
      lastQuantity: parseFloat(raw.Q),
      volume: parseFloat(raw.v),
      quoteVolume: parseFloat(raw.q),
      priceChange: parseFloat(raw.p),
      priceChangePercent: parseFloat(raw.P),
      weightedAveragePrice: parseFloat(raw.w),
      openTime: new Date(raw.O),
      closeTime: new Date(raw.C),
      tradeCount: raw.n,
    };
  }
}
