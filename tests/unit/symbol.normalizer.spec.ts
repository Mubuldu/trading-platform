import { SymbolNormalizer, SymbolMapping } from '@modules/exchange/normalizers/symbol.normalizer';
import { NormalizedSymbol } from '@modules/exchange/models/common.model';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { UnknownSymbolError } from '@modules/exchange/errors/exchange.error';

const BTC_USDT = NormalizedSymbol.unsafe('BTC/USDT');
const ETH_USDT = NormalizedSymbol.unsafe('ETH/USDT');
const BTC_USD = NormalizedSymbol.unsafe('BTC/USD');

describe('SymbolNormalizer', () => {
  let normalizer: SymbolNormalizer;

  beforeEach(() => {
    normalizer = new SymbolNormalizer();
  });

  const binanceMappings: SymbolMapping[] = [
    { exchangeId: ExchangeId.BINANCE_SPOT, exchangeSymbol: 'BTCUSDT', normalizedSymbol: BTC_USDT },
    { exchangeId: ExchangeId.BINANCE_SPOT, exchangeSymbol: 'ETHUSDT', normalizedSymbol: ETH_USDT },
  ];

  const bybitMappings: SymbolMapping[] = [
    { exchangeId: ExchangeId.BYBIT_SPOT, exchangeSymbol: 'BTCUSDT', normalizedSymbol: BTC_USDT },
  ];

  describe('addMapping() / addMappings()', () => {
    it('registers mappings', () => {
      normalizer.addMappings(binanceMappings);
      expect(normalizer.totalMappings).toBe(2);
    });

    it('addMapping() increments count', () => {
      normalizer.addMapping(binanceMappings[0]);
      expect(normalizer.totalMappings).toBe(1);
    });
  });

  describe('normalize()', () => {
    beforeEach(() => normalizer.addMappings(binanceMappings));

    it('normalizes a known exchange symbol', () => {
      const r = normalizer.normalize('BTCUSDT', ExchangeId.BINANCE_SPOT);
      expect(r.isOk()).toBe(true);
      if (r.isOk()) expect(r.value).toBe(BTC_USDT);
    });

    it('is case-insensitive for exchange symbols', () => {
      const r = normalizer.normalize('btcusdt', ExchangeId.BINANCE_SPOT);
      expect(r.isOk()).toBe(true);
    });

    it('returns UnknownSymbolError for unknown symbol', () => {
      const r = normalizer.normalize('XYZABC', ExchangeId.BINANCE_SPOT);
      expect(r.isErr()).toBe(true);
      if (r.isErr()) expect(r.error).toBeInstanceOf(UnknownSymbolError);
    });

    it('returns UnknownSymbolError for wrong exchange', () => {
      const r = normalizer.normalize('BTCUSDT', ExchangeId.BYBIT_SPOT);
      expect(r.isErr()).toBe(true);
    });
  });

  describe('toExchangeSymbol()', () => {
    beforeEach(() => {
      normalizer.addMappings(binanceMappings);
      normalizer.addMappings(bybitMappings);
    });

    it('converts normalized symbol to exchange format', () => {
      const r = normalizer.toExchangeSymbol(BTC_USDT, ExchangeId.BINANCE_SPOT);
      expect(r.isOk()).toBe(true);
      if (r.isOk()) expect(r.value).toBe('BTCUSDT');
    });

    it('returns different exchange format for same symbol', () => {
      const binance = normalizer.toExchangeSymbol(BTC_USDT, ExchangeId.BINANCE_SPOT);
      const bybit = normalizer.toExchangeSymbol(BTC_USDT, ExchangeId.BYBIT_SPOT);
      expect(binance.isOk()).toBe(true);
      expect(bybit.isOk()).toBe(true);
    });

    it('returns error for unknown normalized symbol', () => {
      const r = normalizer.toExchangeSymbol(BTC_USD, ExchangeId.BINANCE_SPOT);
      expect(r.isErr()).toBe(true);
      if (r.isErr()) expect(r.error).toBeInstanceOf(UnknownSymbolError);
    });
  });

  describe('isKnown()', () => {
    beforeEach(() => normalizer.addMappings(binanceMappings));

    it('returns true for known symbol', () => {
      expect(normalizer.isKnown('BTCUSDT', ExchangeId.BINANCE_SPOT)).toBe(true);
    });

    it('returns false for unknown symbol', () => {
      expect(normalizer.isKnown('ZZZZZ', ExchangeId.BINANCE_SPOT)).toBe(false);
    });
  });

  describe('getMappingsForExchange()', () => {
    it('returns all mappings for an exchange', () => {
      normalizer.addMappings(binanceMappings);
      const mappings = normalizer.getMappingsForExchange(ExchangeId.BINANCE_SPOT);
      expect(mappings).toHaveLength(2);
      expect(mappings.map((m) => m.exchangeSymbol)).toContain('BTCUSDT');
    });
  });
});

describe('NormalizedSymbol', () => {
  describe('isValid()', () => {
    it('validates BASE/QUOTE format', () => {
      expect(NormalizedSymbol.isValid('BTC/USDT')).toBe(true);
      expect(NormalizedSymbol.isValid('ETH/BTC')).toBe(true);
    });

    it('validates BASE/QUOTE:SETTLEMENT format', () => {
      expect(NormalizedSymbol.isValid('BTC/USDT:USDT')).toBe(true);
      expect(NormalizedSymbol.isValid('BTC/USDT:2024-03-29')).toBe(true);
    });

    it('rejects bare exchange formats', () => {
      expect(NormalizedSymbol.isValid('BTCUSDT')).toBe(false);
      expect(NormalizedSymbol.isValid('BTC-USDT')).toBe(false);
      expect(NormalizedSymbol.isValid('')).toBe(false);
      expect(NormalizedSymbol.isValid('btc/usdt')).toBe(false);
    });
  });

  describe('parse()', () => {
    it('extracts base and quote', () => {
      const result = NormalizedSymbol.parse('BTC/USDT');
      expect(result).toEqual({ base: 'BTC', quote: 'USDT', settlement: undefined });
    });

    it('extracts base, quote, and settlement', () => {
      const result = NormalizedSymbol.parse('BTC/USDT:USDT');
      expect(result).toEqual({ base: 'BTC', quote: 'USDT', settlement: 'USDT' });
    });

    it('returns null for invalid format', () => {
      expect(NormalizedSymbol.parse('BTCUSDT')).toBeNull();
    });
  });
});
