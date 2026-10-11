import { Timeframe } from '../../../src/modules/indicator/domain/enums/timeframe.enum';
import { IndicatorState } from '../../../src/modules/indicator/domain/enums/indicator-state.enum';
import {
  LowestLowCalculator,
  createLowestLowConfig,
} from '../../../src/modules/indicator/infrastructure/calculators/lowest-low/lowest-low.calculator';
import { LowestLowValue } from '../../../src/modules/indicator/domain/models/indicator-value.model';
import { makeCandle, makeCandles, resetTimestamp } from './helpers/candle.factory';
import { makeFakeHashService } from './helpers/fake-hash.service';

const PERIOD = 20;

function makeCalc(period = PERIOD) {
  return new LowestLowCalculator(
    createLowestLowConfig('BTC/USDT', Timeframe.ONE_MINUTE, period),
    makeFakeHashService(),
  );
}

beforeEach(() => resetTimestamp());

describe('LowestLowCalculator', () => {
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
    it('LL = min low across the window', () => {
      const calc = makeCalc(5);
      const lows = [99, 97, 93, 95, 98];
      calc.warmup(lows.map((l) => makeCandle({ low: l, open: l + 2, close: l + 1, high: l + 3 })));
      const v = (calc.calculate() as any).value as LowestLowValue;
      expect(v.value).toBeCloseTo(Math.min(...lows), 8);
    });

    it('LL = constant low when all bars are equal', () => {
      const calc = makeCalc();
      calc.warmup(makeCandles(PERIOD, { low: 95, open: 100, close: 99, high: 105 }));
      const v = (calc.calculate() as any).value as LowestLowValue;
      expect(v.value).toBeCloseTo(95, 8);
    });

    it('LL is monotonically below high prices', () => {
      const calc = makeCalc(5);
      const lows = [100, 101, 102, 103, 104];
      calc.warmup(lows.map((l) => makeCandle({ low: l, open: l + 2, close: l + 1, high: l + 3 })));
      const v = (calc.calculate() as any).value as LowestLowValue;
      expect(v.value).toBeLessThanOrEqual(Math.max(...lows));
    });
  });

  describe('rolling update', () => {
    it('new lower low replaces old value when window rolls', () => {
      const calc = makeCalc(3);
      // lows: [100, 99, 98] → LL = 98
      calc.warmup(
        [100, 99, 98].map((l) => makeCandle({ low: l, open: l + 2, close: l + 1, high: l + 3 })),
      );
      expect(((calc.calculate() as any).value as LowestLowValue).value).toBeCloseTo(98, 8);

      // Add candle with low=50 → window [99, 98, 50] → LL = 50
      calc.update(makeCandle({ low: 50, open: 53, close: 52, high: 55 }));
      expect(((calc.calculate() as any).value as LowestLowValue).value).toBeCloseTo(50, 8);
    });

    it('old low evicted when window rolls past it', () => {
      const calc = makeCalc(3);
      // lows: [100, 50, 100] → LL = 50
      calc.warmup(
        [100, 50, 100].map((l) => makeCandle({ low: l, open: l + 2, close: l + 1, high: l + 3 })),
      );
      expect(((calc.calculate() as any).value as LowestLowValue).value).toBeCloseTo(50, 8);

      // After 3 updates with low=100, the 50 is evicted → LL = 100
      for (let i = 0; i < 3; i++) {
        calc.update(makeCandle({ low: 100, open: 102, close: 101, high: 103 }));
      }
      expect(((calc.calculate() as any).value as LowestLowValue).value).toBeCloseTo(100, 8);
    });
  });

  describe('historical replay', () => {
    it('warmup with 500 candles gives correct LL for last window', () => {
      const calc = makeCalc(PERIOD);
      const lows = Array.from({ length: 500 }, (_, i) => 100 - (i % 50));
      calc.warmup(lows.map((l) => makeCandle({ low: l, open: l + 2, close: l + 1, high: l + 3 })));
      expect(calc.isWarmedUp()).toBe(true);
      const expected = Math.min(...lows.slice(-PERIOD));
      const v = (calc.calculate() as any).value as LowestLowValue;
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
        [100, 50, 75].map((l) => makeCandle({ low: l, open: l + 2, close: l + 1, high: l + 3 })),
      );
      calc.reset();
      calc.warmup(
        [200, 150, 180].map((l) => makeCandle({ low: l, open: l + 2, close: l + 1, high: l + 3 })),
      );
      expect(((calc.calculate() as any).value as LowestLowValue).value).toBeCloseTo(150, 8);
    });
  });

  describe('Redis publishing', () => {
    it('does not publish before warmup', async () => {
      const hash = makeFakeHashService();
      const calc = new LowestLowCalculator(
        createLowestLowConfig('BTC/USDT', Timeframe.ONE_MINUTE, PERIOD),
        hash,
      );
      await calc.publish();
      expect(hash.set).not.toHaveBeenCalled();
    });

    it('publishes numeric value to indicator:lowest_low', async () => {
      const hash = makeFakeHashService();
      const calc = new LowestLowCalculator(
        createLowestLowConfig('BTC/USDT', Timeframe.ONE_MINUTE, PERIOD),
        hash,
      );
      calc.warmup(makeCandles(PERIOD, { low: 95, open: 100, close: 99, high: 105 }));
      await calc.publish();
      expect(hash.set).toHaveBeenCalledWith(
        'indicator:lowest_low',
        expect.any(String),
        expect.any(Number),
      );
    });
  });

  describe('large dataset', () => {
    it('processes 10000 candles correctly', () => {
      const calc = makeCalc(50);
      const candles = Array.from({ length: 10_000 }, (_, i) =>
        makeCandle({ low: 90 + (i % 50), open: 100, close: 99, high: 105 }),
      );
      calc.warmup(candles);
      expect(calc.isWarmedUp()).toBe(true);
      expect(calc.calculate().isOk()).toBe(true);
    });
  });
});
