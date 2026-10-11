import { Injectable } from '@nestjs/common';
import { Result, ok, err } from '@common/result';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { NormalizedSymbol } from '@modules/exchange/models/common.model';
import { Ticker } from '@modules/exchange/models/market.models';
import {
  ExchangeError,
  ExchangeInvalidRequestError,
} from '@modules/exchange/errors/exchange.error';
import { BinanceRawTicker24hr } from '../client/binance-http.types';

const EX = ExchangeId.BINANCE_SPOT;

/**
 * BinanceTicker24hrMapper normalizes Binance 24hr ticker statistics.
 *
 * The `symbol` on the Ticker is set to a best-effort NormalizedSymbol from
 * the raw Binance symbol string. The adapter resolves the proper normalized
 * symbol via SymbolNormalizer before calling this mapper.
 */
@Injectable()
export class BinanceTicker24hrMapper {
  map(
    raw: BinanceRawTicker24hr,
    normalizedSymbol: NormalizedSymbol,
    receivedAt: Date,
  ): Result<Ticker, ExchangeError> {
    try {
      const lastPrice = parseFloat(raw.lastPrice);
      const bidPrice = parseFloat(raw.bidPrice);
      const askPrice = parseFloat(raw.askPrice);

      return ok({
        exchangeId: EX,
        symbol: normalizedSymbol,
        timestamp: new Date(raw.closeTime),
        receivedAt,

        bestBid: bidPrice,
        bestAsk: askPrice,
        bestBidQuantity: parseFloat(raw.bidQty),
        bestAskQuantity: parseFloat(raw.askQty),
        spread: askPrice - bidPrice,
        midPrice: (bidPrice + askPrice) / 2,

        openPrice: parseFloat(raw.openPrice),
        highPrice: parseFloat(raw.highPrice),
        lowPrice: parseFloat(raw.lowPrice),
        closePrice: lastPrice,
        lastPrice,
        lastQuantity: parseFloat(raw.lastQty),
        volume: parseFloat(raw.volume),
        quoteVolume: parseFloat(raw.quoteVolume),
        priceChange: parseFloat(raw.priceChange),
        priceChangePercent: parseFloat(raw.priceChangePercent),
        weightedAveragePrice: parseFloat(raw.weightedAvgPrice),
        openTime: new Date(raw.openTime),
        closeTime: new Date(raw.closeTime),
        tradeCount: raw.count,
      });
    } catch (e) {
      return err(
        new ExchangeInvalidRequestError(
          EX,
          `Failed to parse ticker for ${raw.symbol}: ${String(e)}`,
          { symbol: raw.symbol },
        ),
      );
    }
  }
}
