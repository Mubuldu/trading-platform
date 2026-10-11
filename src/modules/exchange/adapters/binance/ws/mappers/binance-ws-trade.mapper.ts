import { Injectable } from '@nestjs/common';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { OrderSide } from '@modules/exchange/enums/order.enums';
import { NormalizedSymbol } from '@modules/exchange/models/common.model';
import { Trade } from '@modules/exchange/models/market.models';
import { BinanceWsAggTradeMessage } from '../binance-ws.types';

@Injectable()
export class BinanceWsTradeMapper {
  /**
   * Maps a Binance aggTrade WebSocket message to a normalized Trade.
   *
   * aggTrade aggregates fills at the same price in the same millisecond.
   * The tradeId is the Binance aggregate trade ID (a field).
   * isBuyerMaker = true means the buyer is the market maker (the order was
   * resting on the book when matched), implying a sell-side aggressor.
   */
  map(raw: BinanceWsAggTradeMessage, symbol: NormalizedSymbol, receivedAt: Date): Trade {
    const price = parseFloat(raw.p);
    const quantity = parseFloat(raw.q);

    return {
      exchangeId: ExchangeId.BINANCE_SPOT,
      symbol,
      timestamp: new Date(raw.T),
      receivedAt,
      tradeId: String(raw.a),
      price,
      quantity,
      quoteQuantity: price * quantity,
      // isBuyerMaker=true → buyer is passive (maker) → sell-side aggressor
      side: raw.m ? OrderSide.SELL : OrderSide.BUY,
      isBuyerMaker: raw.m,
    };
  }
}
