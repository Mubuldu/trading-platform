import { Timeframe } from '../../../src/modules/indicator/domain/enums/timeframe.enum';
import { IndicatorState } from '../../../src/modules/indicator/domain/enums/indicator-state.enum';
import {
  TrueRangeCalculator,
  createTrueRangeConfig,
} from '../../../src/modules/indicator/infrastructure/calculators/true-range/true-range.calculator';
import { TrueRangeValue } from '../../../src/modules/indicator/domain/models/indicator-value.model';
import { makeCandle, resetTimestamp } from './helpers/candle.factory';
import { makeFakeHashService } from './helpers/fake-hash.service';

function makeCalc() {
  return new TrueRangeCalculator(
    createTrueRangeConfig('BTC/USDT', Timeframe.ONE_MINUTE),
    makeFakeHashService(),
  );
}

beforeEach(() => resetTimestamp());

describe('TrueRangeCalculator', () => {
  describe('warmup and state', () => {
    it('starts in IDLE', () => {
      expect(makeCalc().state).toBe(IndicatorState.IDLE);
    });

    it('requires 2 candles to warm up', () => {
      expect(makeCalc().getWarmupRequired()).toBe(2);
    });

    it('not warmed up after 1 candle', () => {
      const calc = makeCalc();
      calc.warmup([makeCandle({ open: 100, high: 102, low: 98, close: 100 })]);
      expect(calc.isWarmedUp()).toBe(false);
    });

    it('warmed up after 2 candles', () => {
      const calc = makeCalc();
      calc.warmup([
        makeCandle({ open: 100, high: 102, low: 98, close: 100 }),
        makeCandle({ open: 100, high: 105, low: 97, close: 102 }),
      ]);
      expect(calc.isWarmedUp()).toBe(true);
    });
  });

  describe('mathematical correctness', () => {
    it('TR = high - low when high-low dominates', () => {
      const calc = makeCalc();
      // candle1: close=100; candle2: high=110, low=90, so H-L=20, |H-prevC|=10, |L-prevC|=10 → TR=20
      calc.warmup([
        makeCandle({ open: 100, high: 102, low: 98, close: 100 }),
        makeCandle({ open: 100, high: 110, low: 90, close: 100 }),
      ]);
      const v = (calc.calculate() as any).value as TrueRangeValue;
      expect(v.value).toBeCloseTo(20, 8);
    });

    it('TR = |high - prevClose| when that dominates', () => {
      const calc = makeCalc();
      // candle1: close=100; candle2: high=120, low=105, close=110
      // H-L=15, |H-prevC|=20, |L-prevC|=5 → TR=20
      calc.warmup([
        makeCandle({ open: 100, high: 102, low: 98, close: 100 }),
        makeCandle({ open: 108, high: 120, low: 105, close: 110 }),
      ]);
      const v = (calc.calculate() as any).value as TrueRangeValue;
      expect(v.value).toBeCloseTo(20, 8);
    });

    it('TR = |low - prevClose| when that dominates (gap down)', () => {
      const calc = makeCalc();
      // candle1: close=100; candle2: high=90, low=80, close=85
      // H-L=10, |H-prevC|=10, |L-prevC|=20 → TR=20
      calc.warmup([
        makeCandle({ open: 100, high: 102, low: 98, close: 100 }),
        makeCandle({ open: 85, high: 90, low: 80, close: 85 }),
      ]);
      const v = (calc.calculate() as any).value as TrueRangeValue;
      expect(v.value).toBeCloseTo(20, 8);
    });

    it('TR is always non-negative', () => {
      const calc = makeCalc();
      calc.warmup([
        makeCandle({ open: 100, high: 101, low: 99, close: 100 }),
        makeCandle({ open: 100, high: 101, low: 99, close: 100 }),
      ]);
      const v = (calc.calculate() as any).value as TrueRangeValue;
      expect(v.value).toBeGreaterThanOrEqual(0);
    });

    it('TR updates correctly on rolling update', () => {
      const calc = makeCalc();
      calc.warmup([
        makeCandle({ open: 100, high: 102, low: 98, close: 100 }),
        makeCandle({ open: 100, high: 105, low: 97, close: 103 }),
      ]);
      // Now add a candle with prevClose=103, high=120, low=100 → H-L=20, |H-103|=17, |L-103|=3 → TR=20
      calc.update(makeCandle({ open: 103, high: 120, low: 100, close: 110 }));
      const v = (calc.calculate() as any).value as TrueRangeValue;
      expect(v.value).toBeCloseTo(20, 8);
    });
  });

  describe('historical replay', () => {
    it('warmup with 200 candles produces correct TR for last candle', () => {
      const calc = makeCalc();
      const candles = Array.from({ length: 200 }, (_, i) =>
        makeCandle({ open: 100 + i, high: 102 + i, low: 98 + i, close: 100 + i }),
      );
      calc.warmup(candles);
      expect(calc.isWarmedUp()).toBe(true);
      // All candles have same range pattern, TR = max(H-L=4, |H-prevC|=2, |L-prevC|=2) = 4
      const v = (calc.calculate() as any).value as TrueRangeValue;
      expect(v.value).toBeCloseTo(4, 5);
    });
  });

  describe('reset and restart', () => {
    it('reset returns to IDLE', () => {
      const calc = makeCalc();
      calc.warmup([makeCandle(), makeCandle()]);
      calc.reset();
      expect(calc.state).toBe(IndicatorState.IDLE);
      expect(calc.isWarmedUp()).toBe(false);
    });

    it('can re-warmup after reset', () => {
      const calc = makeCalc();
      calc.warmup([makeCandle(), makeCandle()]);
      calc.reset();
      calc.warmup([
        makeCandle({ open: 100, high: 102, low: 98, close: 100 }),
        makeCandle({ open: 100, high: 110, low: 90, close: 100 }),
      ]);
      expect(calc.isWarmedUp()).toBe(true);
      const v = (calc.calculate() as any).value as TrueRangeValue;
      expect(v.value).toBeCloseTo(20, 8);
    });
  });

  describe('Redis publishing', () => {
    it('does not publish before warmup', async () => {
      const hash = makeFakeHashService();
      const calc = new TrueRangeCalculator(
        createTrueRangeConfig('BTC/USDT', Timeframe.ONE_MINUTE),
        hash,
      );
      await calc.publish();
      expect(hash.set).not.toHaveBeenCalled();
    });

    it('publishes numeric value to indicator:true_range', async () => {
      const hash = makeFakeHashService();
      const calc = new TrueRangeCalculator(
        createTrueRangeConfig('BTC/USDT', Timeframe.ONE_MINUTE),
        hash,
      );
      calc.warmup([
        makeCandle({ open: 100, high: 102, low: 98, close: 100 }),
        makeCandle({ open: 100, high: 110, low: 90, close: 100 }),
      ]);
      await calc.publish();
      expect(hash.set).toHaveBeenCalledWith(
        'indicator:true_range',
        expect.any(String),
        expect.any(Number),
      );
    });
  });
});
