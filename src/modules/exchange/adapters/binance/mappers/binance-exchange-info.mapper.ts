import { Injectable } from '@nestjs/common';
import { Result, ok, err } from '@common/result';
import { ExchangeId, MarketType } from '@modules/exchange/enums/exchange.enums';
import { NormalizedSymbol } from '@modules/exchange/models/common.model';
import { ExchangeInfo, SymbolInfo, RateLimitInfo } from '@modules/exchange/models/exchange.models';
import { ExchangeInvalidRequestError } from '@modules/exchange/errors/exchange.error';
import { ExchangeError } from '@modules/exchange/errors/exchange.error';
import {
  BinanceRawExchangeInfo,
  BinanceRawSymbol,
  BinanceRawSymbolFilter,
  BinanceRawRateLimit,
} from '../client/binance-http.types';

const EX = ExchangeId.BINANCE_SPOT;

/**
 * BinanceExchangeInfoMapper normalizes Binance's exchangeInfo response.
 *
 * Key complexity: Binance encodes trading constraints as a flat array of
 * "filters" with string-typed numeric values. Each filter type carries a
 * different set of keys. This mapper extracts and converts only the filters
 * relevant to our SymbolInfo model.
 *
 * Symbol active check: status must be "TRADING". Symbols in BREAK, HALT,
 * PRE_DELIVERING, etc. are included in the response but are not tradable.
 *
 * Precision calculation: derived from tick/step sizes via decimalCount().
 *   tickSize=0.01  → pricePrecision=2
 *   stepSize=0.001 → quantityPrecision=3
 */
@Injectable()
export class BinanceExchangeInfoMapper {
  map(raw: BinanceRawExchangeInfo): Result<ExchangeInfo, ExchangeError> {
    try {
      const symbols: SymbolInfo[] = [];

      for (const rawSymbol of raw.symbols) {
        if (!rawSymbol.isSpotTradingAllowed) continue;

        const symbolResult = this.mapSymbol(rawSymbol);
        if (symbolResult.isErr()) {
          // Skip malformed symbols — don't fail the entire exchange info
          continue;
        }
        symbols.push(symbolResult.value);
      }

      return ok({
        exchangeId: EX,
        serverTime: new Date(raw.serverTime),
        timezone: raw.timezone,
        rateLimits: raw.rateLimits.map(this.mapRateLimit),
        symbols,
        isMaintenance: false,
      });
    } catch (e) {
      return err(new ExchangeInvalidRequestError(EX, `Failed to parse exchangeInfo: ${String(e)}`));
    }
  }

  mapSymbol(raw: BinanceRawSymbol): Result<SymbolInfo, ExchangeError> {
    try {
      const normalizedSymbol = NormalizedSymbol.unsafe(`${raw.baseAsset}/${raw.quoteAsset}`);

      const priceFilter = this.findFilter(raw.filters, 'PRICE_FILTER');
      const lotFilter = this.findFilter(raw.filters, 'LOT_SIZE');
      const notionalFilter =
        this.findFilter(raw.filters, 'NOTIONAL') ?? this.findFilter(raw.filters, 'MIN_NOTIONAL');

      const tickSize = parseFloat(priceFilter?.tickSize ?? '0.01');
      const minPrice = parseFloat(priceFilter?.minPrice ?? '0');
      const maxPrice = parseFloat(priceFilter?.maxPrice ?? '0');

      const stepSize = parseFloat(lotFilter?.stepSize ?? '0.00000001');
      const minQty = parseFloat(lotFilter?.minQty ?? '0');
      const maxQty = parseFloat(lotFilter?.maxQty ?? '0');

      const minNotional = parseFloat(
        notionalFilter?.minNotional ?? notionalFilter?.minNotional ?? '0',
      );
      const maxNotional = notionalFilter?.maxNotional
        ? parseFloat(notionalFilter.maxNotional)
        : undefined;

      const orderTypes = raw.orderTypes.map((t) => t.toUpperCase());

      return ok({
        symbol: normalizedSymbol,
        exchangeSymbol: raw.symbol,
        baseAsset: raw.baseAsset,
        quoteAsset: raw.quoteAsset,
        exchangeId: EX,
        marketType: MarketType.SPOT,
        isActive: raw.status === 'TRADING',

        pricePrecision: this.decimalCount(tickSize),
        quantityPrecision: this.decimalCount(stepSize),
        quotePrecision: raw.quotePrecision,

        minQuantity: minQty,
        maxQuantity: maxQty > 0 ? maxQty : Number.MAX_SAFE_INTEGER,
        stepSize,
        minPrice,
        maxPrice: maxPrice > 0 ? maxPrice : Number.MAX_SAFE_INTEGER,
        tickSize,
        minNotional,
        maxNotional,

        allowsLimitOrder: orderTypes.includes('LIMIT') || orderTypes.includes('LIMIT_MAKER'),
        allowsMarketOrder: orderTypes.includes('MARKET'),
        allowsStopOrder:
          orderTypes.includes('STOP_LOSS') ||
          orderTypes.includes('STOP_LOSS_LIMIT') ||
          orderTypes.includes('TAKE_PROFIT') ||
          orderTypes.includes('TAKE_PROFIT_LIMIT'),
        allowsPostOnly: orderTypes.includes('LIMIT_MAKER'),
        allowsReduceOnly: false,
        allowsIceberg: raw.icebergAllowed,
      });
    } catch (e) {
      return err(
        new ExchangeInvalidRequestError(EX, `Failed to parse symbol ${raw.symbol}: ${String(e)}`, {
          symbol: raw.symbol,
        }),
      );
    }
  }

  private mapRateLimit(raw: BinanceRawRateLimit): RateLimitInfo {
    return {
      rateLimitType: raw.rateLimitType,
      interval: raw.interval,
      intervalNum: raw.intervalNum,
      limit: raw.limit,
    };
  }

  private findFilter(
    filters: BinanceRawSymbolFilter[],
    type: string,
  ): BinanceRawSymbolFilter | undefined {
    return filters.find((f) => f.filterType === type);
  }

  /**
   * Counts significant decimal places from a floating-point step/tick value.
   * Uses string representation to avoid IEEE 754 precision issues.
   *
   * Examples:
   *   0.01     → 2
   *   0.00100  → 3  (trailing zeros are significant here)
   *   1        → 0
   *   0.5      → 1
   */
  private decimalCount(value: number): number {
    if (value <= 0 || !isFinite(value)) return 8;
    const str = value.toFixed(10);
    const dotIndex = str.indexOf('.');
    if (dotIndex === -1) return 0;
    const decimals = str.slice(dotIndex + 1);
    let last = decimals.length - 1;
    while (last >= 0 && decimals[last] === '0') last--;
    if (last < 0) return 0;
    return last + 1;
  }
}
