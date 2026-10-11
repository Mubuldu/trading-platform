import { Injectable } from '@nestjs/common';
import { Result, ok, err } from '@common/result';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { OrderSide } from '@modules/exchange/enums/order.enums';
import { NormalizedSymbol } from '@modules/exchange/models/common.model';
import { Trade } from '@modules/exchange/models/market.models';
import {
  ExchangeError,
  ExchangeInvalidRequestError,
} from '@modules/exchange/errors/exchange.error';
import { BinanceRawTrade } from '../client/binance-http.types';

const EX = ExchangeId.BINANCE_SPOT;

@Injectable()
export class BinanceTradeMapper {
  map(
    raw: BinanceRawTrade,
    symbol: NormalizedSymbol,
    receivedAt: Date,
  ): Result<Trade, ExchangeError> {
    try {
      const price = parseFloat(raw.price);
      const quantity = parseFloat(raw.qty);
      const quoteQty = parseFloat(raw.quoteQty);

      return ok({
        exchangeId: EX,
        symbol,
        timestamp: new Date(raw.time),
        receivedAt,
        tradeId: String(raw.id),
        price,
        quantity,
        quoteQuantity: quoteQty,
        side: raw.isBuyerMaker ? OrderSide.SELL : OrderSide.BUY,
        isBuyerMaker: raw.isBuyerMaker,
      });
    } catch (e) {
      return err(
        new ExchangeInvalidRequestError(EX, `Failed to parse trade ${raw.id}: ${String(e)}`, {
          tradeId: raw.id,
        }),
      );
    }
  }

  mapMany(
    rawTrades: BinanceRawTrade[],
    symbol: NormalizedSymbol,
    receivedAt: Date,
  ): Result<Trade[], ExchangeError> {
    const trades: Trade[] = [];
    for (const raw of rawTrades) {
      const result = this.map(raw, symbol, receivedAt);
      if (result.isErr()) return err(result.error);
      trades.push(result.value);
    }
    return ok(trades);
  }
}
