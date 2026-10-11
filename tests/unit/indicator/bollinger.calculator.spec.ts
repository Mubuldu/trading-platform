import { Timeframe } from '../../../src/modules/indicator/domain/enums/timeframe.enum';
import {
  BollingerCalculator,
  createBollingerConfig,
} from '../../../src/modules/indicator/infrastructure/calculators/bollinger/bollinger.calculator';
import { BollingerValue } from '../../../src/modules/indicator/domain/models/indicator-value.model';
import { makeCandle, resetTimestamp } from './helpers/candle.factory';
import { makeFakeHashService } from './helpers/fake-hash.service';

const PERIOD = 20;

function makeCalc(stdDev = 2) {
  return new BollingerCalculator(
    createBollingerConfig('BTC/USDT', Timeframe.ONE_MINUTE, PERIOD, stdDev),
    makeFakeHashService(),
  );
}

beforeEach(() => resetTimestamp());

describe('BollingerCalculator', () => {
  it('requires period candles to warm up', () => {
    const calc = makeCalc();
    calc.warmup(
      Array.from({ length: PERIOD }, () =>
        makeCandle({ open: 100, high: 101, low: 99, close: 100 }),
      ),
    );
    expect(calc.isWarmedUp()).toBe(true);
  });

  it('when all prices are the same: stddev=0, bands equal middle', () => {
    const calc = makeCalc();
    calc.warmup(
      Array.from({ length: PERIOD }, () =>
        makeCandle({ open: 100, high: 101, low: 99, close: 100 }),
      ),
    );
    const result = calc.calculate();
    expect(result.isOk()).toBe(true);
    const v = (result as any).value as BollingerValue;
    expect(v.middle).toBeCloseTo(100, 5);
    expect(v.upper).toBeCloseTo(100, 5);
    expect(v.lower).toBeCloseTo(100, 5);
    expect(v.bandwidth).toBeCloseTo(0, 5);
  });

  it('upper = middle + 2*std, lower = middle - 2*std', () => {
    const calc = makeCalc();
    const prices = [
      100, 102, 98, 101, 99, 103, 97, 100, 102, 98, 101, 99, 103, 97, 100, 102, 98, 101, 99, 103,
    ];
    calc.warmup(prices.map((p) => makeCandle({ open: p, high: p + 1, low: p - 1, close: p })));
    const result = calc.calculate();
    const v = (result as any).value as BollingerValue;
    const mean = prices.reduce((a, b) => a + b, 0) / PERIOD;
    const variance = prices.reduce((acc, p) => acc + (p - mean) ** 2, 0) / PERIOD;
    const std = Math.sqrt(variance);
    expect(v.middle).toBeCloseTo(mean, 4);
    expect(v.upper).toBeCloseTo(mean + 2 * std, 4);
    expect(v.lower).toBeCloseTo(mean - 2 * std, 4);
  });

  it('bandwidth is always non-negative', () => {
    const calc = makeCalc();
    calc.warmup(
      Array.from({ length: PERIOD }, (_, i) =>
        makeCandle({ open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i }),
      ),
    );
    const v = (calc.calculate() as any).value as BollingerValue;
    expect(v.bandwidth).toBeGreaterThanOrEqual(0);
  });

  it('%B = 0.5 when close equals middle (all same price)', () => {
    const calc = makeCalc();
    calc.warmup(
      Array.from({ length: PERIOD }, () =>
        makeCandle({ open: 100, high: 101, low: 99, close: 100 }),
      ),
    );
    const v = (calc.calculate() as any).value as BollingerValue;
    expect(v.percentB).toBeCloseTo(0.5, 1);
  });

  it('rolls window correctly вЂ” old prices evicted', () => {
    const calc = makeCalc();
    const initial = Array.from({ length: PERIOD }, () =>
      makeCandle({ open: 100, high: 101, low: 99, close: 100 }),
    );
    calc.warmup(initial);
    // Push in prices that move mean significantly
    for (let i = 0; i < PERIOD; i++) {
      calc.update(makeCandle({ open: 200, high: 201, low: 199, close: 200 }));
    }
    const v = (calc.calculate() as any).value as BollingerValue;
    // After PERIOD new candles all at 200, mean should be near 200
    expect(v.middle).toBeCloseTo(200, 1);
  });

  it('publishes JSON with 5 fields', async () => {
    const hash = makeFakeHashService();
    const calc = new BollingerCalculator(
      createBollingerConfig('BTC/USDT', Timeframe.ONE_MINUTE, PERIOD),
      hash,
    );
    calc.warmup(
      Array.from({ length: PERIOD }, () =>
        makeCandle({ open: 100, high: 101, low: 99, close: 100 }),
      ),
    );
    await calc.publish();
    const lastCall = hash.set.mock.calls[hash.set.mock.calls.length - 1];
    const parsed = JSON.parse(lastCall[2] as string);
    expect(parsed).toHaveProperty('upper');
    expect(parsed).toHaveProperty('middle');
    expect(parsed).toHaveProperty('lower');
    expect(parsed).toHaveProperty('bandwidth');
    expect(parsed).toHaveProperty('percentB');
  });
});
