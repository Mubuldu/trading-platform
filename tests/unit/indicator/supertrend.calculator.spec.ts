import { Timeframe } from '../../../src/modules/indicator/domain/enums/timeframe.enum';
import {
  SupertrendCalculator,
  createSupertrendConfig,
} from '../../../src/modules/indicator/infrastructure/calculators/supertrend/supertrend.calculator';
import { SupertrendValue } from '../../../src/modules/indicator/domain/models/indicator-value.model';
import { makeCandle, resetTimestamp } from './helpers/candle.factory';
import { makeFakeHashService } from './helpers/fake-hash.service';

const PERIOD = 10;
const MULTIPLIER = 3;

function makeCalc() {
  return new SupertrendCalculator(
    createSupertrendConfig('BTC/USDT', Timeframe.ONE_MINUTE, PERIOD, MULTIPLIER),
    makeFakeHashService(),
  );
}

beforeEach(() => resetTimestamp());

function makeTrendCandles(
  count: number,
  priceStart = 100,
  step = 2,
): ReturnType<typeof makeCandle>[] {
  const candles = [];
  for (let i = 0; i < count; i++) {
    const price = priceStart + i * step;
    candles.push(makeCandle({ open: price - 1, close: price, high: price + 2, low: price - 3 }));
  }
  return candles;
}

describe('SupertrendCalculator', () => {
  it('requires period + 1 candles to warm up', () => {
    expect(makeCalc().getWarmupRequired()).toBe(PERIOD + 1);
  });

  it('is warmed up after period + 1 candles', () => {
    const calc = makeCalc();
    calc.warmup(makeTrendCandles(PERIOD + 1));
    expect(calc.isWarmedUp()).toBe(true);
  });

  it('direction is either 1 (bullish) or -1 (bearish)', () => {
    const calc = makeCalc();
    calc.warmup(makeTrendCandles(PERIOD + 1));
    const result = calc.calculate();
    expect(result.isOk()).toBe(true);
    const v = (result as any).value as SupertrendValue;
    expect(v.direction === 1 || v.direction === -1).toBe(true);
  });

  it('strong uptrend produces bullish (1) direction', () => {
    const calc = makeCalc();
    calc.warmup(makeTrendCandles(PERIOD + 1, 100, 5));
    for (let i = 0; i < PERIOD * 2; i++) {
      calc.update(makeCandle({ open: 200 + i, close: 210 + i, high: 215 + i, low: 195 + i }));
    }
    const v = (calc.calculate() as any).value as SupertrendValue;
    expect(v.direction).toBe(1);
  });

  it('strong downtrend produces bearish (-1) direction', () => {
    const calc = makeCalc();
    // PERIOD*2 continuously falling candles — price crosses below the stuck lower band
    // and flips direction to -1 without any price-gap that would spike ATR
    calc.warmup(makeTrendCandles(PERIOD * 2, 500, -5));
    const v = (calc.calculate() as any).value as SupertrendValue;
    expect(v.direction).toBe(-1);
  });

  it('supertrend value is always positive for typical price ranges', () => {
    const calc = makeCalc();
    calc.warmup(makeTrendCandles(PERIOD + 1));
    const v = (calc.calculate() as any).value as SupertrendValue;
    expect(v.value).toBeGreaterThan(0);
  });

  it('publishes JSON with value and direction', async () => {
    const hash = makeFakeHashService();
    const calc = new SupertrendCalculator(
      createSupertrendConfig('BTC/USDT', Timeframe.ONE_MINUTE),
      hash,
    );
    calc.warmup(makeTrendCandles(PERIOD + 1));
    await calc.publish();
    const lastCall = hash.set.mock.calls[hash.set.mock.calls.length - 1];
    const parsed = JSON.parse(lastCall[2] as string);
    expect(parsed).toHaveProperty('value');
    expect(parsed).toHaveProperty('direction');
    expect(parsed.direction === 1 || parsed.direction === -1).toBe(true);
  });

  it('resets and can re-warmup', () => {
    const calc = makeCalc();
    calc.warmup(makeTrendCandles(PERIOD + 1));
    calc.reset();
    expect(calc.isWarmedUp()).toBe(false);
    calc.warmup(makeTrendCandles(PERIOD + 1));
    expect(calc.isWarmedUp()).toBe(true);
  });
});
