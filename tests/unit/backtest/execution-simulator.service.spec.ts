import { ExecutionSimulatorService } from '@modules/backtest/application/execution-simulator/execution-simulator.service';
import { OrderQueueService } from '@modules/backtest/application/execution-simulator/order-queue.service';
import { BacktestConfig } from '@modules/backtest/domain/models/backtest-config.model';
import { DataSourceType } from '@modules/backtest/domain/enums/data-source-type.enum';
import { FillType } from '@modules/backtest/domain/enums/fill-type.enum';
import { Candle } from '@modules/indicator/domain/models/candle.model';
import { Timeframe } from '@modules/indicator/domain/enums/timeframe.enum';
import { OrderSide, OrderType } from '@modules/exchange/enums/order.enums';

const makeCandle = (
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 1000,
): Candle => ({
  symbol: 'BTC/USDT',
  exchange: 'test',
  timeframe: Timeframe.ONE_HOUR,
  openTime: 1_000_000_000_000,
  closeTime: 1_000_003_600_000,
  open,
  high,
  low,
  close,
  volume,
  isClosed: true,
});

const defaultConfig: BacktestConfig = {
  sessionId: 'test-session',
  symbol: 'BTC/USDT',
  exchange: 'test',
  timeframe: Timeframe.ONE_HOUR,
  startTime: 1_000_000_000_000,
  endTime: 1_000_360_000_000,
  warmupCandles: 200,
  initialCapitalUsd: 100_000,
  commission: { makerBps: 10, takerBps: 10 },
  slippage: { fixedBps: 5, volumeParticipationRate: 0.05, maxSlippageBps: 50 },
  dataSource: DataSourceType.CSV,
  strategies: [],
  enableRiskChecks: true,
  maxPositionSizePercent: 10,
  maxDailyLossPercent: 5,
  fillOnClose: false,
};

describe('ExecutionSimulatorService', () => {
  let simulator: ExecutionSimulatorService;
  let queue: OrderQueueService;

  beforeEach(() => {
    queue = new OrderQueueService();
    simulator = new ExecutionSimulatorService(queue);
    simulator.configure(defaultConfig);
  });

  describe('Market orders', () => {
    it('fills market buy order at candle open with positive slippage', () => {
      simulator.submitOrder({
        strategyId: 'strat-1',
        symbol: 'BTC/USDT',
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        quantity: 1,
        submittedAtBarTime: 999_999_999_000,
      });

      const candle = makeCandle(50_000, 52_000, 49_000, 51_000);
      const fills = simulator.processMarketOrdersAtOpen(candle);

      expect(fills).toHaveLength(1);
      expect(fills[0].fillType).toBe(FillType.MARKET_AT_OPEN);
      expect(fills[0].filledQuantity).toBe(1);
      expect(fills[0].fillPrice).toBeGreaterThan(50_000);
      expect(fills[0].commission).toBeGreaterThan(0);
    });

    it('fills market sell order at candle open with negative slippage', () => {
      simulator.submitOrder({
        strategyId: 'strat-1',
        symbol: 'BTC/USDT',
        side: OrderSide.SELL,
        type: OrderType.MARKET,
        quantity: 1,
        submittedAtBarTime: 999_999_999_000,
      });

      const candle = makeCandle(50_000, 52_000, 49_000, 51_000);
      const fills = simulator.processMarketOrdersAtOpen(candle);

      expect(fills[0].fillPrice).toBeLessThan(50_000);
    });

    it('removes order from queue after fill', () => {
      simulator.submitOrder({
        strategyId: 'strat-1',
        symbol: 'BTC/USDT',
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        quantity: 0.5,
        submittedAtBarTime: 999_999_999_000,
      });

      const candle = makeCandle(40_000, 41_000, 39_000, 40_500);
      simulator.processMarketOrdersAtOpen(candle);

      expect(queue.getMarketOrders()).toHaveLength(0);
    });
  });

  describe('Limit orders', () => {
    it('fills buy limit when candle low touches limit price', () => {
      simulator.submitOrder({
        strategyId: 'strat-1',
        symbol: 'BTC/USDT',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        quantity: 1,
        price: 48_000,
        submittedAtBarTime: 999_999_999_000,
      });

      const candle = makeCandle(50_000, 50_500, 47_500, 50_000);
      const fills = simulator.processLimitOrders(candle);

      expect(fills).toHaveLength(1);
      expect(fills[0].fillPrice).toBe(48_000);
      expect(fills[0].fillType).toBe(FillType.LIMIT_PASSIVE);
      expect(fills[0].isMaker).toBe(true);
    });

    it('does not fill buy limit when candle low stays above limit price', () => {
      simulator.submitOrder({
        strategyId: 'strat-1',
        symbol: 'BTC/USDT',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        quantity: 1,
        price: 48_000,
        submittedAtBarTime: 999_999_999_000,
      });

      const candle = makeCandle(50_000, 51_000, 49_000, 50_500);
      const fills = simulator.processLimitOrders(candle);

      expect(fills).toHaveLength(0);
      expect(queue.getLimitOrders()).toHaveLength(1);
    });

    it('fills sell limit when candle high reaches limit price', () => {
      simulator.submitOrder({
        strategyId: 'strat-1',
        symbol: 'BTC/USDT',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        quantity: 1,
        price: 52_000,
        submittedAtBarTime: 999_999_999_000,
      });

      const candle = makeCandle(50_000, 53_000, 49_500, 51_000);
      const fills = simulator.processLimitOrders(candle);

      expect(fills).toHaveLength(1);
      expect(fills[0].fillPrice).toBe(52_000);
    });
  });

  describe('Stop orders', () => {
    it('triggers sell stop when candle low touches stop price', () => {
      simulator.submitOrder({
        strategyId: 'strat-1',
        symbol: 'BTC/USDT',
        side: OrderSide.SELL,
        type: OrderType.STOP,
        quantity: 1,
        stopPrice: 48_000,
        submittedAtBarTime: 999_999_999_000,
      });

      const candle = makeCandle(50_000, 50_500, 47_000, 49_000);
      const fills = simulator.processStopOrders(candle);

      expect(fills).toHaveLength(1);
      expect(fills[0].fillType).toBe(FillType.STOP_TRIGGERED);
      expect(fills[0].fillPrice).toBeLessThanOrEqual(48_000);
    });

    it('does not trigger sell stop when candle stays above stop price', () => {
      simulator.submitOrder({
        strategyId: 'strat-1',
        symbol: 'BTC/USDT',
        side: OrderSide.SELL,
        type: OrderType.STOP,
        quantity: 1,
        stopPrice: 48_000,
        submittedAtBarTime: 999_999_999_000,
      });

      const candle = makeCandle(50_000, 51_000, 49_000, 50_500);
      const fills = simulator.processStopOrders(candle);

      expect(fills).toHaveLength(0);
    });
  });

  describe('processAllOrdersForCandle', () => {
    it('processes market and limit orders in the same bar', () => {
      simulator.submitOrder({
        strategyId: 'strat-1',
        symbol: 'BTC/USDT',
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        quantity: 0.1,
        submittedAtBarTime: 999_999_999_000,
      });

      simulator.submitOrder({
        strategyId: 'strat-1',
        symbol: 'BTC/USDT',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        quantity: 0.5,
        price: 55_000,
        submittedAtBarTime: 999_999_999_000,
      });

      const candle = makeCandle(50_000, 56_000, 49_000, 54_000);
      const fills = simulator.processAllOrdersForCandle(candle);

      expect(fills).toHaveLength(2);
    });
  });
});
