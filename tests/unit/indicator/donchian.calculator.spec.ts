import { Timeframe } from '../../../src/modules/indicator/domain/enums/timeframe.enum';
import {
  DonchianCalculator,
  createDonchianConfig,
} from '../../../src/modules/indicator/infrastructure/calculators/donchian/donchian.calculator';
import { DonchianValue } from '../../../src/modules/indicator/domain/models/indicator-value.model';
import { makeCandle, resetTimestamp } from './helpers/candle.factory';
import { makeFakeHashService } from './helpers/fake-hash.service';

const PERIOD = 20;

function makeCalc() {
  return new DonchianCalculator(
    createDonchianConfig('BTC/USDT', Timeframe.ONE_MINUTE, PERIOD),
    makeFakeHashService(),
  );
}

beforeEach(() => resetTimestamp());

describe('DonchianCalculator', () => {
  it('requires exactly period candles to warm up', () => {
    const calc = makeCalc();
    calc.warmup(Array.from({ length: PERIOD }, () => makeCandle()));
    expect(calc.isWarmedUp()).toBe(true);
  });

  it('not warmed up with period - 1 candles', () => {
    const calc = makeCalc();
    calc.warmup(Array.from({ length: PERIOD - 1 }, () => makeCandle()));
    expect(calc.isWarmedUp()).toBe(false);
  });

  it('upper = max high, lower = min low, middle = avg', () => {
    const calc = makeCalc();
    const candles = Array.from({ length: PERIOD }, (_, i) => {
      return makeCandle({ open: 100, high: 100 + i, low: 100 - i, close: 100 });
    });
    calc.warmup(candles);
    const result = calc.calculate();
    expect(result.isOk()).toBe(true);
    const v = (result as any).value as DonchianValue;
    expect(v.upper).toBe(100 + PERIOD - 1);
    expect(v.lower).toBe(100 - (PERIOD - 1));
    expect(v.middle).toBeCloseTo((v.upper + v.lower) / 2, 10);
  });

  it('rolls the window: oldest candle evicted', () => {
    const calc = makeCalc();
    // First PERIOD candles: high=100, low=99
    calc.warmup(
      Array.from({ length: PERIOD }, () => makeCandle({ open: 99, high: 100, low: 99, close: 99 })),
    );
    // Add a candle with much higher high and much lower low
    calc.update(makeCandle({ open: 200, high: 300, low: 50, close: 200 }));
    const result = calc.calculate();
    const v = (result as any).value as DonchianValue;
    expect(v.upper).toBe(300);
    expect(v.lower).toBe(50);

    // Add PERIOD more plain candles to evict the extreme candle
    for (let i = 0; i < PERIOD; i++) {
      calc.update(makeCandle({ open: 100, high: 101, low: 99, close: 100 }));
    }
    const result2 = calc.calculate();
    const v2 = (result2 as any).value as DonchianValue;
    // The extreme candle should now be evicted
    expect(v2.upper).toBeLessThan(300);
    expect(v2.lower).toBeGreaterThan(50);
  });

  it('publishes JSON with upper, lower, middle', async () => {
    const hash = makeFakeHashService();
    const calc = new DonchianCalculator(
      createDonchianConfig('BTC/USDT', Timeframe.ONE_MINUTE, PERIOD),
      hash,
    );
    calc.warmup(
      Array.from({ length: PERIOD }, () =>
        makeCandle({ open: 100, high: 102, low: 98, close: 100 }),
      ),
    );
    await calc.publish();
    const lastCall = hash.set.mock.calls[hash.set.mock.calls.length - 1];
    const parsed = JSON.parse(lastCall[2] as string);
    expect(parsed).toHaveProperty('upper');
    expect(parsed).toHaveProperty('lower');
    expect(parsed).toHaveProperty('middle');
  });

  it('upper >= lower always', () => {
    const calc = makeCalc();
    calc.warmup(Array.from({ length: PERIOD }, () => makeCandle()));
    for (let i = 0; i < 50; i++) {
      calc.update(makeCandle());
      const result = calc.calculate();
      const v = (result as any).value as DonchianValue;
      expect(v.upper).toBeGreaterThanOrEqual(v.lower);
    }
  });
});
