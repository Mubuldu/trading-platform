import { Injectable } from '@nestjs/common';
import { Result, ok, err } from '@common/result';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { NormalizedSymbol } from '@modules/exchange/models/common.model';
import { OrderBook, OrderBookLevel } from '@modules/exchange/models/market.models';
import {
  ExchangeError,
  ExchangeInvalidRequestError,
} from '@modules/exchange/errors/exchange.error';
import { BinanceRawOrderBook } from '../client/binance-http.types';

const EX = ExchangeId.BINANCE_SPOT;

@Injectable()
export class BinanceOrderBookMapper {
  map(
    raw: BinanceRawOrderBook,
    symbol: NormalizedSymbol,
    receivedAt: Date,
  ): Result<OrderBook, ExchangeError> {
    try {
      const bids: OrderBookLevel[] = raw.bids.map(([price, qty]) => ({
        price: parseFloat(price),
        quantity: parseFloat(qty),
      }));

      const asks: OrderBookLevel[] = raw.asks.map(([price, qty]) => ({
        price: parseFloat(price),
        quantity: parseFloat(qty),
      }));

      return ok({
        exchangeId: EX,
        symbol,
        timestamp: receivedAt,
        receivedAt,
        lastUpdateId: raw.lastUpdateId,
        bids,
        asks,
        depth: Math.max(bids.length, asks.length),
        isSnapshot: true,
      });
    } catch (e) {
      return err(new ExchangeInvalidRequestError(EX, `Failed to parse order book: ${String(e)}`));
    }
  }
}
