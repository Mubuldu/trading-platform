import { Timeframe } from '../../../src/modules/indicator/domain/enums/timeframe.enum';
import { IndicatorState } from '../../../src/modules/indicator/domain/enums/indicator-state.enum';
import {
  SmaCalculator,
  createSmaConfig,
} from '../../../src/modules/indicator/infrastructure/calculators/sma/sma.calculator';
import { SmaValue } from '../../../src/modules/indicator/domain/models/indicator-value.model';
import { makeCandle, makeCandles, resetTimestamp } from './helpers/candle.factory';
import { makeFakeHashService } from './helpers/fake-hash.service';

const PERIOD = 20;

function makeCalc(period = PERIOD) {
  return new SmaCalculator(
    createSmaConfig('BTC/USDT', Timeframe.ONE_MINUTE, period),
    makeFakeHashService(),
  );
}

beforeEach(() => resetTimestamp());

describe('SmaCalculator', () => {
  describe('warmup and state', () => {
    it('starts in IDLE state', () => {
      expect(makeCalc().state).toBe(IndicatorState.IDLE);
    });

    it('requires exactly period candles to warm up', () => {
      expect(makeCalc().getWarmupRequired()).toBe(PERIOD);
    });

    it('stays not warmed up with period - 1 candles', () => {
      const calc = makeCalc();
      calc.warmup(makeCandles(PERIOD - 1));
      expect(calc.isWarmedUp()).toBe(false);
    });

    it('transitions to READY after exactly period candles', () => {
      const calc = makeCalc();
      calc.warmup(makeCandles(PERIOD));
      expect(calc.state).toBe(IndicatorState.READY);
      expect(calc.isWarmedUp()).toBe(true);
    });

    it('calculate() returns err when not warmed up', () => {
      expect(makeCalc().calculate().isErr()).toBe(true);
    });
  });

  describe('mathematical correctness', () => {
    it('computes correct SMA for constant price', () => {
      const calc = makeCalc();
      const price = 150;
      calc.warmup(
        makeCandles(PERIOD, { close: price, open: price, high: price + 1, low: price - 1 }),
      );
      const result = calc.calculate();
      expect(result.isOk()).toBe(true);
      expect(((result as any).value as SmaValue).value).toBeCloseTo(price, 8);
    });

    it('computes correct SMA for known sequence', () => {
      const calc = makeCalc(5);
      // prices [1, 2, 3, 4, 5] → SMA = 3
      const prices = [1, 2, 3, 4, 5];
      calc.warmup(prices.map((p) => makeCandle({ close: p, open: p, high: p + 1, low: p - 1 })));
      const result = calc.calculate();
      expect(((result as any).value as SmaValue).value).toBeCloseTo(3, 8);
    });

    it('SMA equals arithmetic mean of the window', () => {
      const prices = [100, 102, 98, 105, 97, 103, 101, 99, 104, 96];
      const calc = makeCalc(10);
      calc.warmup(prices.map((p) => makeCandle({ close: p, open: p, high: p + 1, low: p - 1 })));
      const expected = prices.reduce((a, b) => a + b, 0) / 10;
      const result = calc.calculate();
      expect(((result as any).value as SmaValue).value).toBeCloseTo(expected, 8);
    });
  });

  describe('rolling update', () => {
    it('evicts oldest price and updates correctly', () => {
      const calc = makeCalc(3);
      // Fill with [10, 20, 30] → SMA = 20
      calc.warmup(
        [10, 20, 30].map((p) => makeCandle({ close: p, open: p, high: p + 1, low: p - 1 })),
      );
      expect(((calc.calculate() as any).value as SmaValue).value).toBeCloseTo(20, 8);

      // Add 40 → window [20, 30, 40] → SMA = 30
      calc.update(makeCandle({ close: 40, open: 40, high: 41, low: 39 }));
      expect(((calc.calculate() as any).value as SmaValue).value).toBeCloseTo(30, 8);
    });

    it('rolls full window correctly after many updates', () => {
      const calc = makeCalc(PERIOD);
      calc.warmup(makeCandles(PERIOD, { close: 100, open: 100, high: 101, low: 99 }));
      for (let i = 0; i < PERIOD; i++) {
        calc.update(makeCandle({ close: 200, open: 200, high: 201, low: 199 }));
      }
      expect(((calc.calculate() as any).value as SmaValue).value).toBeCloseTo(200, 4);
    });
  });

  describe('historical replay', () => {
    it('warmup with large dataset produces correct final SMA', () => {
      const calc = makeCalc(PERIOD);
      const prices = Array.from({ length: 500 }, (_, i) => 100 + Math.sin(i * 0.1) * 10);
      const candles = prices.map((p) => makeCandle({ close: p, open: p, high: p + 1, low: p - 1 }));
      calc.warmup(candles);
      expect(calc.isWarmedUp()).toBe(true);
      const expected = prices.slice(-PERIOD).reduce((a, b) => a + b, 0) / PERIOD;
      const result = calc.calculate();
      expect(((result as any).value as SmaValue).value).toBeCloseTo(expected, 4);
    });
  });

  describe('reset and restart', () => {
    it('reset clears state and returns to IDLE', () => {
      const calc = makeCalc();
      calc.warmup(makeCandles(PERIOD));
      calc.reset();
      expect(calc.state).toBe(IndicatorState.IDLE);
      expect(calc.isWarmedUp()).toBe(false);
      expect(calc.getCandlesProcessed()).toBe(0);
    });

    it('can re-warmup after reset and produces correct value', () => {
      const calc = makeCalc(3);
      calc.warmup([1, 2, 3].map((p) => makeCandle({ close: p, open: p, high: p + 1, low: p - 1 })));
      calc.reset();
      calc.warmup(
        [10, 20, 30].map((p) => makeCandle({ close: p, open: p, high: p + 1, low: p - 1 })),
      );
      expect(calc.isWarmedUp()).toBe(true);
      expect(((calc.calculate() as any).value as SmaValue).value).toBeCloseTo(20, 8);
    });
  });

  describe('Redis publishing', () => {
    it('does not publish before warmup', async () => {
      const hash = makeFakeHashService();
      const calc = new SmaCalculator(
        createSmaConfig('BTC/USDT', Timeframe.ONE_MINUTE, PERIOD),
        hash,
      );
      await calc.publish();
      expect(hash.set).not.toHaveBeenCalled();
    });

    it('publishes numeric value to indicator:sma', async () => {
      const hash = makeFakeHashService();
      const calc = new SmaCalculator(
        createSmaConfig('BTC/USDT', Timeframe.ONE_MINUTE, PERIOD),
        hash,
      );
      calc.warmup(makeCandles(PERIOD, { close: 100, open: 100, high: 101, low: 99 }));
      await calc.publish();
      expect(hash.set).toHaveBeenCalledWith(
        'indicator:sma',
        expect.any(String),
        expect.any(Number),
      );
    });

    it('skips Redis write when value is unchanged', async () => {
      const hash = makeFakeHashService();
      const calc = new SmaCalculator(
        createSmaConfig('BTC/USDT', Timeframe.ONE_MINUTE, PERIOD),
        hash,
      );
      calc.warmup(makeCandles(PERIOD, { close: 100, open: 100, high: 101, low: 99 }));
      await calc.publish();
      await calc.publish(); // same value
      expect(hash.set).toHaveBeenCalledTimes(1);
    });
  });

  describe('health / snapshot', () => {
    it('getHealth returns latestValue after calculate()', () => {
      const calc = makeCalc();
      calc.warmup(makeCandles(PERIOD));
      calc.calculate();
      const h = calc.getHealth();
      expect(h.latestValue).not.toBeNull();
      expect(h.historyLength).toBe(PERIOD);
      expect(h.warmupRequired).toBe(PERIOD);
      expect(h.state).toBe(IndicatorState.READY);
    });

    it('latestValue is null before any calculate()', () => {
      const calc = makeCalc();
      expect(calc.getHealth().latestValue).toBeNull();
    });
  });

  describe('large dataset performance', () => {
    it('processes 10000 candles without error', () => {
      const calc = makeCalc(50);
      const candles = Array.from({ length: 10_000 }, (_, i) =>
        makeCandle({ close: 100 + (i % 100), open: 100, high: 101, low: 99 }),
      );
      calc.warmup(candles);
      expect(calc.isWarmedUp()).toBe(true);
      expect(calc.calculate().isOk()).toBe(true);
    });
  });
});
