import { Timeframe } from '../../../src/modules/indicator/domain/enums/timeframe.enum';
import { IndicatorState } from '../../../src/modules/indicator/domain/enums/indicator-state.enum';
import {
  VolumeMaCalculator,
  createVolumeMaConfig,
} from '../../../src/modules/indicator/infrastructure/calculators/volume-ma/volume-ma.calculator';
import { VolumeMaValue } from '../../../src/modules/indicator/domain/models/indicator-value.model';
import { makeCandle, makeCandles, resetTimestamp } from './helpers/candle.factory';
import { makeFakeHashService } from './helpers/fake-hash.service';

const PERIOD = 20;

function makeCalc(period = PERIOD) {
  return new VolumeMaCalculator(
    createVolumeMaConfig('BTC/USDT', Timeframe.ONE_MINUTE, period),
    makeFakeHashService(),
  );
}

beforeEach(() => resetTimestamp());

describe('VolumeMaCalculator', () => {
  describe('warmup and state', () => {
    it('starts in IDLE state', () => {
      expect(makeCalc().state).toBe(IndicatorState.IDLE);
    });

    it('requires period candles to warm up', () => {
      expect(makeCalc().getWarmupRequired()).toBe(PERIOD);
    });

    it('stays not warmed up with period - 1 candles', () => {
      const calc = makeCalc();
      calc.warmup(makeCandles(PERIOD - 1, { volume: 1000 }));
      expect(calc.isWarmedUp()).toBe(false);
    });

    it('transitions to READY after exactly period candles', () => {
      const calc = makeCalc();
      calc.warmup(makeCandles(PERIOD, { volume: 1000 }));
      expect(calc.isWarmedUp()).toBe(true);
    });
  });

  describe('mathematical correctness', () => {
    it('VMA = volume when all volumes are equal', () => {
      const calc = makeCalc();
      calc.warmup(makeCandles(PERIOD, { volume: 5000 }));
      const v = (calc.calculate() as any).value as VolumeMaValue;
      expect(v.value).toBeCloseTo(5000, 8);
    });

    it('VMA equals arithmetic mean of volumes', () => {
      const calc = makeCalc(5);
      const volumes = [1000, 2000, 3000, 4000, 5000];
      calc.warmup(volumes.map((vol) => makeCandle({ volume: vol })));
      const expected = volumes.reduce((a, b) => a + b, 0) / 5;
      const v = (calc.calculate() as any).value as VolumeMaValue;
      expect(v.value).toBeCloseTo(expected, 8);
    });

    it('VMA is always non-negative', () => {
      const calc = makeCalc();
      calc.warmup(makeCandles(PERIOD, { volume: 100 }));
      const v = (calc.calculate() as any).value as VolumeMaValue;
      expect(v.value).toBeGreaterThanOrEqual(0);
    });
  });

  describe('rolling update', () => {
    it('evicts oldest volume and updates correctly', () => {
      const calc = makeCalc(3);
      calc.warmup([1000, 2000, 3000].map((vol) => makeCandle({ volume: vol })));
      expect(((calc.calculate() as any).value as VolumeMaValue).value).toBeCloseTo(2000, 8);

      // Add 4000 → window [2000, 3000, 4000] → VMA = 3000
      calc.update(makeCandle({ volume: 4000 }));
      expect(((calc.calculate() as any).value as VolumeMaValue).value).toBeCloseTo(3000, 8);
    });

    it('rolls full window correctly after period updates', () => {
      const calc = makeCalc(PERIOD);
      calc.warmup(makeCandles(PERIOD, { volume: 1000 }));
      for (let i = 0; i < PERIOD; i++) {
        calc.update(makeCandle({ volume: 9000 }));
      }
      expect(((calc.calculate() as any).value as VolumeMaValue).value).toBeCloseTo(9000, 4);
    });
  });

  describe('historical replay', () => {
    it('warmup with 500 candles gives correct final VMA', () => {
      const calc = makeCalc(PERIOD);
      const volumes = Array.from({ length: 500 }, (_, i) => 1000 + (i % 50) * 100);
      calc.warmup(volumes.map((vol) => makeCandle({ volume: vol })));
      expect(calc.isWarmedUp()).toBe(true);
      const expected = volumes.slice(-PERIOD).reduce((a, b) => a + b, 0) / PERIOD;
      expect(((calc.calculate() as any).value as VolumeMaValue).value).toBeCloseTo(expected, 4);
    });
  });

  describe('reset and restart', () => {
    it('reset returns to IDLE and clears processed count', () => {
      const calc = makeCalc();
      calc.warmup(makeCandles(PERIOD, { volume: 1000 }));
      calc.reset();
      expect(calc.state).toBe(IndicatorState.IDLE);
      expect(calc.getCandlesProcessed()).toBe(0);
    });

    it('can re-warmup after reset', () => {
      const calc = makeCalc(3);
      calc.warmup([1, 2, 3].map((vol) => makeCandle({ volume: vol })));
      calc.reset();
      calc.warmup([100, 200, 300].map((vol) => makeCandle({ volume: vol })));
      expect(calc.isWarmedUp()).toBe(true);
      expect(((calc.calculate() as any).value as VolumeMaValue).value).toBeCloseTo(200, 8);
    });
  });

  describe('Redis publishing', () => {
    it('does not publish before warmup', async () => {
      const hash = makeFakeHashService();
      const calc = new VolumeMaCalculator(
        createVolumeMaConfig('BTC/USDT', Timeframe.ONE_MINUTE, PERIOD),
        hash,
      );
      await calc.publish();
      expect(hash.set).not.toHaveBeenCalled();
    });

    it('publishes numeric value to indicator:volume_ma', async () => {
      const hash = makeFakeHashService();
      const calc = new VolumeMaCalculator(
        createVolumeMaConfig('BTC/USDT', Timeframe.ONE_MINUTE, PERIOD),
        hash,
      );
      calc.warmup(makeCandles(PERIOD, { volume: 1000 }));
      await calc.publish();
      expect(hash.set).toHaveBeenCalledWith(
        'indicator:volume_ma',
        expect.any(String),
        expect.any(Number),
      );
    });

    it('skips Redis write when value unchanged', async () => {
      const hash = makeFakeHashService();
      const calc = new VolumeMaCalculator(
        createVolumeMaConfig('BTC/USDT', Timeframe.ONE_MINUTE, PERIOD),
        hash,
      );
      calc.warmup(makeCandles(PERIOD, { volume: 1000 }));
      await calc.publish();
      await calc.publish();
      expect(hash.set).toHaveBeenCalledTimes(1);
    });
  });

  describe('large dataset', () => {
    it('processes 10000 candles correctly', () => {
      const calc = makeCalc(50);
      const candles = Array.from({ length: 10_000 }, (_, i) =>
        makeCandle({ volume: 1000 + (i % 500) }),
      );
      calc.warmup(candles);
      expect(calc.isWarmedUp()).toBe(true);
      expect(calc.calculate().isOk()).toBe(true);
    });
  });
});
