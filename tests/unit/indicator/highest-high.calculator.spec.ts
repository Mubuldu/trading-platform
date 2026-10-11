import { Timeframe } from '../../../src/modules/indicator/domain/enums/timeframe.enum';
import { IndicatorState } from '../../../src/modules/indicator/domain/enums/indicator-state.enum';
import {
  HighestHighCalculator,
  createHighestHighConfig,
} from '../../../src/modules/indicator/infrastructure/calculators/highest-high/highest-high.calculator';
import { HighestHighValue } from '../../../src/modules/indicator/domain/models/indicator-value.model';
import { makeCandle, makeCandles, resetTimestamp } from './helpers/candle.factory';
import { makeFakeHashService } from './helpers/fake-hash.service';

const PERIOD = 20;

function makeCalc(period = PERIOD) {
  return new HighestHighCalculator(
    createHighestHighConfig('BTC/USDT', Timeframe.ONE_MINUTE, period),
    makeFakeHashService(),
  );
}

beforeEach(() => resetTimestamp());

describe('HighestHighCalculator', () => {
  describe('warmup and state', () => {
    it('starts in IDLE', () => {
      expect(makeCalc().state).toBe(IndicatorState.IDLE);
    });

    it('requires period candles to warm up', () => {
      expect(makeCalc().getWarmupRequired()).toBe(PERIOD);
    });

    it('not warmed up with period - 1 candles', () => {
      const calc = makeCalc();
      calc.warmup(makeCandles(PERIOD - 1));
      expect(calc.isWarmedUp()).toBe(false);
    });

    it('warmed up after period candles', () => {
      const calc = makeCalc();
      calc.warmup(makeCandles(PERIOD));
      expect(calc.isWarmedUp()).toBe(true);
    });
  });

  describe('mathematical correctness', () => {
    it('HH = max high across the window', () => {
      const calc = makeCalc(5);
      const highs = [101, 103, 107, 105, 102];
      calc.warmup(highs.map((h) => makeCandle({ open: h - 2, close: h - 1, high: h, low: h - 3 })));
      const v = (calc.calculate() as any).value as HighestHighValue;
      expect(v.value).toBeCloseTo(Math.max(...highs), 8);
    });

    it('HH = constant high when all bars are equal', () => {
      const calc = makeCalc();
      calc.warmup(makeCandles(PERIOD, { high: 105, open: 100, close: 103, low: 99 }));
      const v = (calc.calculate() as any).value as HighestHighValue;
      expect(v.value).toBeCloseTo(105, 8);
    });

    it('HH is monotonically above low prices', () => {
      const calc = makeCalc(5);
      const highs = [100, 101, 102, 103, 104];
      calc.warmup(highs.map((h) => makeCandle({ high: h, open: h - 2, close: h - 1, low: h - 3 })));
      const v = (calc.calculate() as any).value as HighestHighValue;
      expect(v.value).toBeGreaterThanOrEqual(Math.min(...highs));
    });
  });

  describe('rolling update', () => {
    it('new higher high replaces old value when window rolls', () => {
      const calc = makeCalc(3);
      // highs: [100, 101, 102] → HH = 102
      calc.warmup(
        [100, 101, 102].map((h) => makeCandle({ high: h, open: h - 2, close: h - 1, low: h - 3 })),
      );
      expect(((calc.calculate() as any).value as HighestHighValue).value).toBeCloseTo(102, 8);

      // Add candle with high=200 → window [101, 102, 200] → HH = 200
      calc.update(makeCandle({ high: 200, open: 198, close: 199, low: 197 }));
      expect(((calc.calculate() as any).value as HighestHighValue).value).toBeCloseTo(200, 8);
    });

    it('old high evicted when window rolls past it', () => {
      const calc = makeCalc(3);
      // highs: [100, 200, 100] → HH = 200
      calc.warmup(
        [100, 200, 100].map((h) => makeCandle({ high: h, open: h - 2, close: h - 1, low: h - 3 })),
      );
      expect(((calc.calculate() as any).value as HighestHighValue).value).toBeCloseTo(200, 8);

      // After 3 updates with high=100, the 200 is evicted → HH = 100
      for (let i = 0; i < 3; i++) {
        calc.update(makeCandle({ high: 100, open: 98, close: 99, low: 97 }));
      }
      expect(((calc.calculate() as any).value as HighestHighValue).value).toBeCloseTo(100, 8);
    });
  });

  describe('historical replay', () => {
    it('warmup with 500 candles gives correct HH for last window', () => {
      const calc = makeCalc(PERIOD);
      const highs = Array.from({ length: 500 }, (_, i) => 100 + (i % 50));
      calc.warmup(highs.map((h) => makeCandle({ high: h, open: h - 2, close: h - 1, low: h - 3 })));
      expect(calc.isWarmedUp()).toBe(true);
      const expected = Math.max(...highs.slice(-PERIOD));
      const v = (calc.calculate() as any).value as HighestHighValue;
      expect(v.value).toBeCloseTo(expected, 5);
    });
  });

  describe('reset and restart', () => {
    it('reset clears state', () => {
      const calc = makeCalc();
      calc.warmup(makeCandles(PERIOD));
      calc.reset();
      expect(calc.state).toBe(IndicatorState.IDLE);
      expect(calc.isWarmedUp()).toBe(false);
    });

    it('can re-warmup after reset', () => {
      const calc = makeCalc(3);
      calc.warmup(
        [100, 200, 300].map((h) => makeCandle({ high: h, open: h - 2, close: h - 1, low: h - 3 })),
      );
      calc.reset();
      calc.warmup(
        [10, 20, 15].map((h) => makeCandle({ high: h, open: h - 2, close: h - 1, low: h - 3 })),
      );
      expect(((calc.calculate() as any).value as HighestHighValue).value).toBeCloseTo(20, 8);
    });
  });

  describe('Redis publishing', () => {
    it('does not publish before warmup', async () => {
      const hash = makeFakeHashService();
      const calc = new HighestHighCalculator(
        createHighestHighConfig('BTC/USDT', Timeframe.ONE_MINUTE, PERIOD),
        hash,
      );
      await calc.publish();
      expect(hash.set).not.toHaveBeenCalled();
    });

    it('publishes numeric value to indicator:highest_high', async () => {
      const hash = makeFakeHashService();
      const calc = new HighestHighCalculator(
        createHighestHighConfig('BTC/USDT', Timeframe.ONE_MINUTE, PERIOD),
        hash,
      );
      calc.warmup(makeCandles(PERIOD, { high: 105, open: 100, close: 103, low: 99 }));
      await calc.publish();
      expect(hash.set).toHaveBeenCalledWith(
        'indicator:highest_high',
        expect.any(String),
        expect.any(Number),
      );
    });
  });

  describe('large dataset', () => {
    it('processes 10000 candles correctly', () => {
      const calc = makeCalc(50);
      const candles = Array.from({ length: 10_000 }, (_, i) =>
        makeCandle({ high: 100 + (i % 100), open: 99, close: 100, low: 98 }),
      );
      calc.warmup(candles);
      expect(calc.isWarmedUp()).toBe(true);
      expect(calc.calculate().isOk()).toBe(true);
    });
  });
});
