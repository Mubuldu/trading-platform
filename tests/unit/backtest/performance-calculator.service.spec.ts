import { PerformanceCalculatorService } from '@modules/backtest/application/reports/statistics/performance-calculator.service';
import { TradeRecord } from '@modules/backtest/domain/models/trade-record.model';
import { OrderSide } from '@modules/exchange/enums/order.enums';

describe('PerformanceCalculatorService', () => {
  let service: PerformanceCalculatorService;

  beforeEach(() => {
    service = new PerformanceCalculatorService();
  });

  const makeTrade = (netPnl: number, entryPrice = 100, qty = 1): TradeRecord => ({
    tradeId: 'trade-1',
    strategyId: 'strat-1',
    symbol: 'BTC/USDT',
    side: OrderSide.BUY,
    entryTime: 0,
    exitTime: 86_400_000,
    entryPrice,
    exitPrice: entryPrice + netPnl / qty,
    quantity: qty,
    grossPnl: netPnl,
    commission: 0,
    netPnl,
    durationMs: 86_400_000,
    maePercent: 0,
    mfePercent: 0,
    entryOrderId: 'entry',
    exitOrderId: 'exit',
  });

  describe('totalReturn', () => {
    it('computes total return correctly', () => {
      const result = service.compute(100_000, 120_000, [], [], 0, 365 * 86_400_000);
      expect(result.totalReturn).toBe(20_000);
      expect(result.totalReturnPercent).toBeCloseTo(20, 2);
    });

    it('returns zero when initial capital is zero', () => {
      const result = service.compute(0, 0, [], [], 0, 0);
      expect(result.totalReturnPercent).toBe(0);
    });
  });

  describe('winRate', () => {
    it('computes win rate as fraction', () => {
      const trades = [makeTrade(500), makeTrade(-200), makeTrade(300), makeTrade(-100)];
      const result = service.compute(100_000, 100_500, trades, [], 0, 86_400_000);
      expect(result.winRate).toBeCloseTo(0.5, 2);
      expect(result.winningTrades).toBe(2);
      expect(result.losingTrades).toBe(2);
    });

    it('returns zero win rate with no trades', () => {
      const result = service.compute(100_000, 100_000, [], [], 0, 86_400_000);
      expect(result.winRate).toBe(0);
      expect(result.totalTrades).toBe(0);
    });
  });

  describe('profitFactor', () => {
    it('computes profit factor correctly', () => {
      const trades = [makeTrade(1000), makeTrade(500), makeTrade(-200), makeTrade(-300)];
      const result = service.compute(100_000, 101_000, trades, [], 0, 86_400_000);
      expect(result.profitFactor).toBeCloseTo(3.0, 1);
    });

    it('returns zero when no winning trades', () => {
      const trades = [makeTrade(-100), makeTrade(-200)];
      const result = service.compute(100_000, 99_700, trades, [], 0, 86_400_000);
      expect(result.profitFactor).toBe(0);
    });
  });

  describe('annualizedReturn', () => {
    it('annualizes correctly over one year', () => {
      const yearMs = 365.25 * 24 * 3600 * 1000;
      const result = service.compute(100_000, 110_000, [], [], 0, yearMs);
      expect(result.annualizedReturnPercent).toBeCloseTo(10, 0.5);
    });

    it('annualizes higher than simple return over six months', () => {
      const sixMonthMs = 182 * 24 * 3600 * 1000;
      const result = service.compute(100_000, 110_000, [], [], 0, sixMonthMs);
      expect(result.annualizedReturnPercent).toBeGreaterThan(10);
    });
  });

  describe('largestWin/Loss', () => {
    it('identifies largest win and loss', () => {
      const trades = [makeTrade(1000), makeTrade(200), makeTrade(-500), makeTrade(-100)];
      const result = service.compute(100_000, 100_600, trades, [], 0, 86_400_000);
      expect(result.largestWin).toBe(1000);
      expect(result.largestLoss).toBe(500);
    });
  });
});
