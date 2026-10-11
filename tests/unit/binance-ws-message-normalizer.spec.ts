import { BinanceWsMessageNormalizer } from '@modules/exchange/adapters/binance/ws/binance-ws-message-normalizer';
import { BinanceWsTickerMapper } from '@modules/exchange/adapters/binance/ws/mappers/binance-ws-ticker.mapper';
import { BinanceWsOrderBookMapper } from '@modules/exchange/adapters/binance/ws/mappers/binance-ws-order-book.mapper';
import { BinanceWsTradeMapper } from '@modules/exchange/adapters/binance/ws/mappers/binance-ws-trade.mapper';
import { SymbolNormalizer } from '@modules/exchange/normalizers/symbol.normalizer';
import { NormalizedSymbol } from '@modules/exchange/models/common.model';
import { MARKET_DATA_EVENTS } from '@modules/exchange/models/common.model';
import { ok } from '@common/result';
import { BINANCE_WS_EVENT } from '@modules/exchange/adapters/binance/ws/binance-ws.constants';

const BTCUSDT_NORMALIZED = NormalizedSymbol.unsafe('BTC/USDT');

function makeNormalizer(): {
  normalizer: BinanceWsMessageNormalizer;
  symbolNormalizer: jest.Mocked<SymbolNormalizer>;
} {
  const symbolNormalizer = {
    normalize: jest.fn().mockReturnValue(ok(BTCUSDT_NORMALIZED)),
    toExchangeSymbol: jest.fn(),
    addMapping: jest.fn(),
  } as unknown as jest.Mocked<SymbolNormalizer>;

  const tickerMapper = new BinanceWsTickerMapper();
  const orderBookMapper = new BinanceWsOrderBookMapper();
  const tradeMapper = new BinanceWsTradeMapper();

  const normalizer = new BinanceWsMessageNormalizer(
    symbolNormalizer,
    tickerMapper,
    orderBookMapper,
    tradeMapper,
  );

  return { normalizer, symbolNormalizer };
}

const receivedAt = new Date();

const rawTicker = {
  e: BINANCE_WS_EVENT.TICKER,
  E: Date.now(),
  s: 'BTCUSDT',
  p: '100.00',
  P: '1.5',
  w: '65000.00',
  x: '64900.00',
  c: '65000.00',
  Q: '0.01',
  b: '64999.00',
  B: '1.0',
  a: '65001.00',
  A: '0.5',
  o: '64900.00',
  h: '65500.00',
  l: '64500.00',
  v: '5000.00',
  q: '325000000.00',
  O: Date.now() - 86400000,
  C: Date.now(),
  F: 1000,
  L: 2000,
  n: 1000,
};

const rawTrade = {
  e: BINANCE_WS_EVENT.AGG_TRADE,
  E: Date.now(),
  s: 'BTCUSDT',
  a: 99999,
  p: '65000.00',
  q: '0.5',
  f: 100,
  l: 105,
  T: Date.now() - 10,
  m: false,
};

const rawDepth = {
  e: BINANCE_WS_EVENT.DEPTH_UPDATE,
  E: Date.now(),
  s: 'BTCUSDT',
  U: 101,
  u: 105,
  b: [
    ['65000.00', '1.0'],
    ['64999.00', '0'],
  ],
  a: [['65001.00', '0.5']],
};

describe('BinanceWsMessageNormalizer', () => {
  describe('normalize — ticker', () => {
    it('returns TICKER_UPDATED with Ticker payload', () => {
      const { normalizer } = makeNormalizer();
      const result = normalizer.normalize('btcusdt@ticker', rawTicker, receivedAt);
      expect(result).not.toBeNull();
      expect(result!.eventType).toBe(MARKET_DATA_EVENTS.TICKER_UPDATED);
      expect(result!.symbol).toBe(BTCUSDT_NORMALIZED);
      expect(result!.exchangeTimestampMs).toBe(rawTicker.E);
      expect(result!.updateId).toBeUndefined();
    });

    it('returns null when symbolNormalizer fails', () => {
      const { normalizer, symbolNormalizer } = makeNormalizer();
      symbolNormalizer.normalize.mockReturnValue({ isOk: () => false, isErr: () => true } as any);
      expect(normalizer.normalize('btcusdt@ticker', rawTicker, receivedAt)).toBeNull();
    });
  });

  describe('normalize — aggTrade', () => {
    it('returns TRADE_EXECUTED with Trade payload', () => {
      const { normalizer } = makeNormalizer();
      const result = normalizer.normalize('btcusdt@aggTrade', rawTrade, receivedAt);
      expect(result).not.toBeNull();
      expect(result!.eventType).toBe(MARKET_DATA_EVENTS.TRADE_EXECUTED);
      expect(result!.updateId).toBe(rawTrade.a);
    });

    it('maps isBuyerMaker=false to BUY side', () => {
      const { normalizer } = makeNormalizer();
      const result = normalizer.normalize(
        'btcusdt@aggTrade',
        { ...rawTrade, m: false },
        receivedAt,
      );
      expect((result!.payload as any).side).toBe('BUY');
    });

    it('maps isBuyerMaker=true to SELL side', () => {
      const { normalizer } = makeNormalizer();
      const result = normalizer.normalize('btcusdt@aggTrade', { ...rawTrade, m: true }, receivedAt);
      expect((result!.payload as any).side).toBe('SELL');
    });
  });

  describe('normalize — depthUpdate', () => {
    it('returns ORDER_BOOK_UPDATED with OrderBook payload', () => {
      const { normalizer } = makeNormalizer();
      const result = normalizer.normalize('btcusdt@depth@100ms', rawDepth, receivedAt);
      expect(result).not.toBeNull();
      expect(result!.eventType).toBe(MARKET_DATA_EVENTS.ORDER_BOOK_UPDATED);
      expect(result!.updateId).toBe(rawDepth.u);
      expect(result!.firstUpdateId).toBe(rawDepth.U);
    });

    it('sets isSnapshot=false on the payload', () => {
      const { normalizer } = makeNormalizer();
      const result = normalizer.normalize('btcusdt@depth@100ms', rawDepth, receivedAt);
      expect((result!.payload as any).isSnapshot).toBe(false);
    });
  });

  describe('normalize — unknown event type', () => {
    it('returns null for messages with unrecognized event type', () => {
      const { normalizer } = makeNormalizer();
      const unknown = { e: 'unknownEventType', E: Date.now(), s: 'BTCUSDT' };
      expect(normalizer.normalize('btcusdt@something', unknown, receivedAt)).toBeNull();
    });

    it('returns null for null data', () => {
      const { normalizer } = makeNormalizer();
      expect(normalizer.normalize('s', null, receivedAt)).toBeNull();
    });

    it('returns null for non-object data', () => {
      const { normalizer } = makeNormalizer();
      expect(normalizer.normalize('s', 'raw string', receivedAt)).toBeNull();
    });
  });
});
