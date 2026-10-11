import { Timeframe } from '../../../src/modules/indicator/domain/enums/timeframe.enum';
import { IndicatorState } from '../../../src/modules/indicator/domain/enums/indicator-state.enum';
import {
  VolumeSpikeCalculator,
  createVolumeSpikeConfig,
} from '../../../src/modules/indicator/infrastructure/calculators/volume-spike/volume-spike.calculator';
import { VolumeSpikeValue } from '../../../src/modules/indicator/domain/models/indicator-value.model';
import { makeCandle, makeCandles, resetTimestamp } from './helpers/candle.factory';
import { makeFakeHashService } from './helpers/fake-hash.service';

const PERIOD = 20;
const THRESHOLD = 2.0;

function makeCalc(period = PERIOD, threshold = THRESHOLD) {
  return new VolumeSpikeCalculator(
    createVolumeSpikeConfig('BTC/USDT', Timeframe.ONE_MINUTE, period, threshold),
    makeFakeHashService(),
  );
}

beforeEach(() => resetTimestamp());

describe('VolumeSpikeCalculator', () => {
  describe('warmup and state', () => {
    it('starts in IDLE', () => {
      expect(makeCalc().state).toBe(IndicatorState.IDLE);
    });

    it('requires period candles to warm up', () => {
      expect(makeCalc().getWarmupRequired()).toBe(PERIOD);
    });

    it('not warmed up with period - 1 candles', () => {
      const calc = makeCalc();
      calc.warmup(makeCandles(PERIOD - 1, { volume: 1000 }));
      expect(calc.isWarmedUp()).toBe(false);
    });

    it('warmed up after period candles', () => {
      const calc = makeCalc();
      calc.warmup(makeCandles(PERIOD, { volume: 1000 }));
      expect(calc.isWarmedUp()).toBe(true);
    });
  });

  describe('mathematical correctness', () => {
    it('ratio = 1 when all volumes are equal (current included in avg)', () => {
      const calc = makeCalc();
      calc.warmup(makeCandles(PERIOD, { volume: 1000 }));
      const v = (calc.calculate() as any).value as VolumeSpikeValue;
      expect(v.ratio).toBeCloseTo(1, 5);
      expect(v.isSpike).toBe(false);
    });

    it('isSpike = true when current volume > threshold * avg', () => {
      const calc = makeCalc(4, 2.0);
      // 3 candles at 1000, 1 candle at 10000 → avg = (1000+1000+1000+10000)/4 = 3250
      // currentVolume = 10000, ratio = 10000/3250 ≈ 3.07 → spike
      const candles = [
        makeCandle({ volume: 1000 }),
        makeCandle({ volume: 1000 }),
        makeCandle({ volume: 1000 }),
        makeCandle({ volume: 10_000 }),
      ];
      calc.warmup(candles);
      const v = (calc.calculate() as any).value as VolumeSpikeValue;
      expect(v.isSpike).toBe(true);
      expect(v.ratio).toBeGreaterThan(2.0);
    });

    it('isSpike = false when volume is below threshold', () => {
      const calc = makeCalc(4, 2.0);
      // All same volume → ratio = 1, no spike
      calc.warmup(makeCandles(4, { volume: 1000 }));
      const v = (calc.calculate() as any).value as VolumeSpikeValue;
      expect(v.isSpike).toBe(false);
    });

    it('returns avgVolume and currentVolume', () => {
      const calc = makeCalc(3, 2.0);
      calc.warmup([100, 200, 300].map((vol) => makeCandle({ volume: vol })));
      const v = (calc.calculate() as any).value as VolumeSpikeValue;
      expect(v.avgVolume).toBeGreaterThan(0);
      expect(v.currentVolume).toBeGreaterThan(0);
    });

    it('ratio is always positive', () => {
      const calc = makeCalc();
      calc.warmup(makeCandles(PERIOD, { volume: 500 }));
      const v = (calc.calculate() as any).value as VolumeSpikeValue;
      expect(v.ratio).toBeGreaterThan(0);
    });
  });

  describe('rolling update', () => {
    it('detects new spike after rolling update', () => {
      const calc = makeCalc(4, 2.0);
      calc.warmup(makeCandles(4, { volume: 1000 }));
      // Spike candle added after warmup
      calc.update(makeCandle({ volume: 100_000 }));
      const v = (calc.calculate() as any).value as VolumeSpikeValue;
      expect(v.isSpike).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('does not divide by zero when avgVolume is 0', () => {
      const calc = makeCalc(3, 2.0);
      // All zero volumes
      calc.warmup([0, 0, 0].map((vol) => makeCandle({ volume: vol })));
      expect(() => calc.calculate()).not.toThrow();
      const v = (calc.calculate() as any).value as VolumeSpikeValue;
      expect(Number.isFinite(v.ratio)).toBe(true);
    });
  });

  describe('reset and restart', () => {
    it('reset returns to IDLE', () => {
      const calc = makeCalc();
      calc.warmup(makeCandles(PERIOD, { volume: 1000 }));
      calc.reset();
      expect(calc.state).toBe(IndicatorState.IDLE);
      expect(calc.isWarmedUp()).toBe(false);
    });

    it('can re-warmup after reset', () => {
      const calc = makeCalc(3, 2.0);
      calc.warmup(makeCandles(3, { volume: 1000 }));
      calc.reset();
      calc.warmup(makeCandles(3, { volume: 5000 }));
      expect(calc.isWarmedUp()).toBe(true);
      const v = (calc.calculate() as any).value as VolumeSpikeValue;
      expect(v.avgVolume).toBeCloseTo(5000, 4);
    });
  });

  describe('Redis publishing', () => {
    it('does not publish before warmup', async () => {
      const hash = makeFakeHashService();
      const calc = new VolumeSpikeCalculator(
        createVolumeSpikeConfig('BTC/USDT', Timeframe.ONE_MINUTE, PERIOD),
        hash,
      );
      await calc.publish();
      expect(hash.set).not.toHaveBeenCalled();
    });

    it('publishes JSON with ratio, avgVolume, currentVolume, isSpike', async () => {
      const hash = makeFakeHashService();
      const calc = new VolumeSpikeCalculator(
        createVolumeSpikeConfig('BTC/USDT', Timeframe.ONE_MINUTE, PERIOD),
        hash,
      );
      calc.warmup(makeCandles(PERIOD, { volume: 1000 }));
      await calc.publish();
      const lastCall = hash.set.mock.calls[hash.set.mock.calls.length - 1];
      const parsed = JSON.parse(lastCall[2] as string);
      expect(parsed).toHaveProperty('ratio');
      expect(parsed).toHaveProperty('avgVolume');
      expect(parsed).toHaveProperty('currentVolume');
      expect(parsed).toHaveProperty('isSpike');
    });
  });
});
