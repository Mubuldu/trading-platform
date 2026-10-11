import { PortfolioExposureService } from '../../../src/modules/portfolio/application/services/portfolio-exposure.service';
import { PositionSummary } from '../../../src/modules/portfolio/domain/models/portfolio-state.model';

function makePosition(overrides: Partial<PositionSummary> = {}): PositionSummary {
  return {
    positionId: 'BINANCE:BTCUSDT',
    exchangeId: 'BINANCE',
    symbol: 'BTCUSDT',
    asset: 'BTC',
    strategyId: 'strat-1',
    direction: 'LONG',
    state: 'OPEN',
    quantity: 1,
    averageEntryPrice: 50_000,
    notionalValue: 50_000,
    unrealizedPnl: 0,
    realizedPnl: 0,
    totalFees: 0,
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('PortfolioExposureService', () => {
  let svc: PortfolioExposureService;

  beforeEach(() => {
    svc = new PortfolioExposureService();
  });

  // ── extractAsset ──────────────────────────────────────────────────────────

  describe('extractAsset', () => {
    it('handles slash-separated symbols', () => {
      expect(svc.extractAsset('BTC/USDT')).toBe('BTC');
      expect(svc.extractAsset('ETH/USDC')).toBe('ETH');
    });

    it('strips USDT suffix', () => {
      expect(svc.extractAsset('BTCUSDT')).toBe('BTC');
      expect(svc.extractAsset('ETHUSDT')).toBe('ETH');
    });

    it('strips USDC suffix', () => {
      expect(svc.extractAsset('SOLUSDC')).toBe('SOL');
    });

    it('strips BUSD suffix', () => {
      expect(svc.extractAsset('BNBBUSD')).toBe('BNB');
    });

    it('handles perpetual contracts', () => {
      const asset = svc.extractAsset('BTCUSD_PERP');
      expect(asset).toBe('BTC');
    });
  });

  // ── compute ───────────────────────────────────────────────────────────────

  describe('compute', () => {
    it('returns zeroed exposure for empty positions', () => {
      const result = svc.compute([]);
      expect(result.totalGrossExposure).toBe(0);
      expect(result.totalNetExposure).toBe(0);
      expect(result.byDirection.long).toBe(0);
      expect(result.byDirection.short).toBe(0);
    });

    it('ignores FLAT positions', () => {
      const flat = makePosition({ state: 'FLAT', quantity: 0 });
      const result = svc.compute([flat]);
      expect(result.totalGrossExposure).toBe(0);
    });

    it('aggregates by symbol', () => {
      const p = makePosition({ symbol: 'BTCUSDT', notionalValue: 50_000 });
      const result = svc.compute([p]);
      expect(result.bySymbol['BTCUSDT']).toBe(50_000);
    });

    it('aggregates by asset', () => {
      const p = makePosition({ asset: 'BTC', notionalValue: 50_000 });
      const result = svc.compute([p]);
      expect(result.byAsset['BTC']).toBe(50_000);
    });

    it('aggregates by exchange', () => {
      const p = makePosition({ exchangeId: 'BINANCE', notionalValue: 50_000 });
      const result = svc.compute([p]);
      expect(result.byExchange['BINANCE']).toBe(50_000);
    });

    it('aggregates by strategy', () => {
      const p = makePosition({ strategyId: 'strat-1', notionalValue: 50_000 });
      const result = svc.compute([p]);
      expect(result.byStrategy['strat-1']).toBe(50_000);
    });

    it('separates long and short correctly', () => {
      const long = makePosition({ direction: 'LONG', notionalValue: 60_000 });
      const short = makePosition({
        positionId: 'BINANCE:ETHUSDT',
        symbol: 'ETHUSDT',
        direction: 'SHORT',
        notionalValue: 40_000,
      });
      const result = svc.compute([long, short]);
      expect(result.byDirection.long).toBe(60_000);
      expect(result.byDirection.short).toBe(40_000);
      expect(result.byDirection.net).toBe(20_000);
      expect(result.byDirection.gross).toBe(100_000);
      expect(result.totalGrossExposure).toBe(100_000);
      expect(result.totalNetExposure).toBe(20_000);
    });

    it('sums multiple positions in same symbol', () => {
      const p1 = makePosition({ notionalValue: 30_000 });
      const p2 = makePosition({
        positionId: 'OKX:BTCUSDT',
        exchangeId: 'OKX',
        notionalValue: 20_000,
      });
      const result = svc.compute([p1, p2]);
      expect(result.bySymbol['BTCUSDT']).toBe(50_000);
    });

    it('multiple strategies get separate allocations', () => {
      const p1 = makePosition({ strategyId: 'strat-a', notionalValue: 40_000 });
      const p2 = makePosition({
        positionId: 'BINANCE:ETHUSDT',
        symbol: 'ETHUSDT',
        strategyId: 'strat-b',
        notionalValue: 30_000,
      });
      const result = svc.compute([p1, p2]);
      expect(result.byStrategy['strat-a']).toBe(40_000);
      expect(result.byStrategy['strat-b']).toBe(30_000);
    });

    it('sets computedAt to a recent timestamp', () => {
      const before = Date.now();
      const result = svc.compute([]);
      expect(result.computedAt).toBeGreaterThanOrEqual(before);
    });
  });
});
