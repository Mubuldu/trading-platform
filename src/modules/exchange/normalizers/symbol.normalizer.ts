import { Injectable } from '@nestjs/common';
import { Result, ok, err } from '@common/result';
import { NormalizedSymbol } from '../models/common.model';
import { ExchangeId } from '../enums/exchange.enums';
import { UnknownSymbolError } from '../errors/exchange.error';

export interface SymbolMapping {
  readonly exchangeId: ExchangeId;
  readonly exchangeSymbol: string;
  readonly normalizedSymbol: NormalizedSymbol;
}

/**
 * SymbolNormalizer is the single source of truth for symbol translation.
 *
 * Each exchange uses different symbol formats:
 *   Binance:  "BTCUSDT"
 *   Bybit:    "BTCUSDT" or "BTC-USDT"
 *   Coinbase: "BTC-USD"
 *   Kraken:   "XXBTZUSD"
 *
 * These all normalize to "BTC/USDT" or "BTC/USD" in our canonical format.
 *
 * The normalizer is seeded at adapter initialization time from ExchangeInfo.
 * Each adapter registers its full symbol list, creating the bidirectional
 * mapping table (exchange format ↔ internal format).
 *
 * Why not auto-decompose: automatically splitting "BTCUSDT" into "BTC"+"USDT"
 * requires knowing the complete set of valid quote assets, which changes over
 * time. Using an explicit mapping table from exchange metadata is more reliable
 * and handles edge cases (e.g. "LINKUSDT" where "LINK" is the base, not "L").
 *
 * Thread safety: addMapping() and normalize() are synchronous; the Map is
 * not shared across async contexts in a way that would cause races.
 */
@Injectable()
export class SymbolNormalizer {
  private readonly exchangeToNormalized = new Map<string, NormalizedSymbol>();
  private readonly normalizedToExchange = new Map<NormalizedSymbol, Map<ExchangeId, string>>();

  addMapping(mapping: SymbolMapping): void {
    const exchangeKey = this.buildExchangeKey(mapping.exchangeId, mapping.exchangeSymbol);
    this.exchangeToNormalized.set(exchangeKey, mapping.normalizedSymbol);

    if (!this.normalizedToExchange.has(mapping.normalizedSymbol)) {
      this.normalizedToExchange.set(mapping.normalizedSymbol, new Map());
    }
    this.normalizedToExchange
      .get(mapping.normalizedSymbol)!
      .set(mapping.exchangeId, mapping.exchangeSymbol);
  }

  addMappings(mappings: SymbolMapping[]): void {
    for (const mapping of mappings) {
      this.addMapping(mapping);
    }
  }

  normalize(
    exchangeSymbol: string,
    exchangeId: ExchangeId,
  ): Result<NormalizedSymbol, UnknownSymbolError> {
    const key = this.buildExchangeKey(exchangeId, exchangeSymbol);
    const normalized = this.exchangeToNormalized.get(key);

    if (!normalized) {
      return err(new UnknownSymbolError(exchangeId, NormalizedSymbol.unsafe(exchangeSymbol)));
    }

    return ok(normalized);
  }

  toExchangeSymbol(
    normalizedSymbol: NormalizedSymbol,
    exchangeId: ExchangeId,
  ): Result<string, UnknownSymbolError> {
    const exchangeMap = this.normalizedToExchange.get(normalizedSymbol);
    const exchangeSymbol = exchangeMap?.get(exchangeId);

    if (!exchangeSymbol) {
      return err(new UnknownSymbolError(exchangeId, normalizedSymbol));
    }

    return ok(exchangeSymbol);
  }

  isKnown(exchangeSymbol: string, exchangeId: ExchangeId): boolean {
    return this.exchangeToNormalized.has(this.buildExchangeKey(exchangeId, exchangeSymbol));
  }

  getMappingsForExchange(exchangeId: ExchangeId): SymbolMapping[] {
    return [...this.exchangeToNormalized.entries()]
      .filter(([key]) => key.startsWith(`${exchangeId}:`))
      .map(([key, normalizedSymbol]) => ({
        exchangeId,
        exchangeSymbol: key.slice(`${exchangeId}:`.length),
        normalizedSymbol,
      }));
  }

  get totalMappings(): number {
    return this.exchangeToNormalized.size;
  }

  private buildExchangeKey(exchangeId: ExchangeId, symbol: string): string {
    return `${exchangeId}:${symbol.toUpperCase()}`;
  }
}
