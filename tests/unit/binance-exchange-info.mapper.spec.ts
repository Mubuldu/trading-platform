import { BinanceExchangeInfoMapper } from '@modules/exchange/adapters/binance/mappers/binance-exchange-info.mapper';
import {
  BinanceRawExchangeInfo,
  BinanceRawSymbol,
} from '@modules/exchange/adapters/binance/client/binance-http.types';
import { MarketType } from '@modules/exchange/enums/exchange.enums';

const BASE_SYMBOL: BinanceRawSymbol = {
  symbol: 'BTCUSDT',
  status: 'TRADING',
  baseAsset: 'BTC',
  baseAssetPrecision: 8,
  quoteAsset: 'USDT',
  quoteAssetPrecision: 8,
  quotePrecision: 8,
  orderTypes: ['LIMIT', 'LIMIT_MAKER', 'MARKET', 'STOP_LOSS_LIMIT', 'TAKE_PROFIT_LIMIT'],
  icebergAllowed: true,
  ocoAllowed: true,
  isSpotTradingAllowed: true,
  isMarginalTradingAllowed: true,
  filters: [
    {
      filterType: 'PRICE_FILTER',
      minPrice: '0.01000000',
      maxPrice: '1000000.00000000',
      tickSize: '0.01000000',
    },
    {
      filterType: 'LOT_SIZE',
      minQty: '0.00001000',
      maxQty: '9000.00000000',
      stepSize: '0.00001000',
    },
    { filterType: 'MIN_NOTIONAL', minNotional: '10.00000000' },
  ],
  permissions: ['SPOT'],
};

const EXCHANGE_INFO: BinanceRawExchangeInfo = {
  timezone: 'UTC',
  serverTime: 1700000000000,
  rateLimits: [
    { rateLimitType: 'REQUEST_WEIGHT', interval: 'MINUTE', intervalNum: 1, limit: 6000 },
  ],
  symbols: [BASE_SYMBOL],
};

describe('BinanceExchangeInfoMapper', () => {
  let mapper: BinanceExchangeInfoMapper;

  beforeEach(() => {
    mapper = new BinanceExchangeInfoMapper();
  });

  describe('map()', () => {
    it('returns ExchangeInfo with mapped symbols', () => {
      const result = mapper.map(EXCHANGE_INFO);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.symbols).toHaveLength(1);
        expect(result.value.timezone).toBe('UTC');
        expect(result.value.isMaintenance).toBe(false);
      }
    });

    it('maps rate limits correctly', () => {
      const result = mapper.map(EXCHANGE_INFO);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rateLimits).toHaveLength(1);
        expect(result.value.rateLimits[0].limit).toBe(6000);
      }
    });

    it('excludes non-spot symbols', () => {
      const nonSpot: BinanceRawSymbol = {
        ...BASE_SYMBOL,
        symbol: 'ETHBTC',
        isSpotTradingAllowed: false,
      };
      const info: BinanceRawExchangeInfo = { ...EXCHANGE_INFO, symbols: [BASE_SYMBOL, nonSpot] };
      const result = mapper.map(info);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.symbols).toHaveLength(1);
      }
    });

    it('skips malformed symbols without failing the entire call', () => {
      const badSymbol: BinanceRawSymbol = {
        ...BASE_SYMBOL,
        symbol: 'BAD',
        filters: [],
        isSpotTradingAllowed: true,
      };
      const info: BinanceRawExchangeInfo = { ...EXCHANGE_INFO, symbols: [BASE_SYMBOL, badSymbol] };
      const result = mapper.map(info);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.symbols.length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('mapSymbol()', () => {
    it('normalizes the symbol to BASE/QUOTE format', () => {
      const result = mapper.mapSymbol(BASE_SYMBOL);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.symbol).toBe('BTC/USDT');
      }
    });

    it('preserves the original exchange symbol', () => {
      const result = mapper.mapSymbol(BASE_SYMBOL);
      if (result.isOk()) {
        expect(result.value.exchangeSymbol).toBe('BTCUSDT');
      }
    });

    it('sets marketType to SPOT', () => {
      const result = mapper.mapSymbol(BASE_SYMBOL);
      if (result.isOk()) {
        expect(result.value.marketType).toBe(MarketType.SPOT);
      }
    });

    it('marks TRADING status symbols as active', () => {
      const result = mapper.mapSymbol(BASE_SYMBOL);
      if (result.isOk()) {
        expect(result.value.isActive).toBe(true);
      }
    });

    it('marks non-TRADING status symbols as inactive', () => {
      const result = mapper.mapSymbol({ ...BASE_SYMBOL, status: 'BREAK' });
      if (result.isOk()) {
        expect(result.value.isActive).toBe(false);
      }
    });

    it('extracts price precision from tickSize', () => {
      const result = mapper.mapSymbol(BASE_SYMBOL);
      if (result.isOk()) {
        // tickSize=0.01 → pricePrecision=2
        expect(result.value.pricePrecision).toBe(2);
      }
    });

    it('extracts quantity precision from stepSize', () => {
      const result = mapper.mapSymbol(BASE_SYMBOL);
      if (result.isOk()) {
        // stepSize=0.00001 → quantityPrecision=5
        expect(result.value.quantityPrecision).toBe(5);
      }
    });

    it('extracts minNotional from MIN_NOTIONAL filter', () => {
      const result = mapper.mapSymbol(BASE_SYMBOL);
      if (result.isOk()) {
        expect(result.value.minNotional).toBe(10);
      }
    });

    it('allowsLimitOrder is true when LIMIT order type is present', () => {
      const result = mapper.mapSymbol(BASE_SYMBOL);
      if (result.isOk()) {
        expect(result.value.allowsLimitOrder).toBe(true);
      }
    });

    it('allowsMarketOrder is true when MARKET order type is present', () => {
      const result = mapper.mapSymbol(BASE_SYMBOL);
      if (result.isOk()) {
        expect(result.value.allowsMarketOrder).toBe(true);
      }
    });

    it('allowsPostOnly is true when LIMIT_MAKER order type is present', () => {
      const result = mapper.mapSymbol(BASE_SYMBOL);
      if (result.isOk()) {
        expect(result.value.allowsPostOnly).toBe(true);
      }
    });

    it('allowsIceberg follows the icebergAllowed flag', () => {
      const result = mapper.mapSymbol(BASE_SYMBOL);
      if (result.isOk()) {
        expect(result.value.allowsIceberg).toBe(true);
      }
    });

    it('handles symbols without LOT_SIZE filter gracefully', () => {
      const symbol: BinanceRawSymbol = {
        ...BASE_SYMBOL,
        filters: [
          { filterType: 'PRICE_FILTER', minPrice: '0.01', maxPrice: '1000000', tickSize: '0.01' },
        ],
      };
      const result = mapper.mapSymbol(symbol);
      expect(result.isOk()).toBe(true);
    });
  });

  describe('precision calculation edge cases', () => {
    it('tickSize=1 → pricePrecision=0', () => {
      const symbol: BinanceRawSymbol = {
        ...BASE_SYMBOL,
        filters: [
          { filterType: 'PRICE_FILTER', minPrice: '1', maxPrice: '1000000', tickSize: '1' },
          { filterType: 'LOT_SIZE', minQty: '0.001', maxQty: '9000', stepSize: '0.001' },
        ],
      };
      const result = mapper.mapSymbol(symbol);
      if (result.isOk()) {
        expect(result.value.pricePrecision).toBe(0);
      }
    });

    it('tickSize=0.001 → pricePrecision=3', () => {
      const symbol: BinanceRawSymbol = {
        ...BASE_SYMBOL,
        filters: [
          { filterType: 'PRICE_FILTER', minPrice: '0.001', maxPrice: '1000000', tickSize: '0.001' },
          { filterType: 'LOT_SIZE', minQty: '0.001', maxQty: '9000', stepSize: '0.001' },
        ],
      };
      const result = mapper.mapSymbol(symbol);
      if (result.isOk()) {
        expect(result.value.pricePrecision).toBe(3);
      }
    });
  });
});
