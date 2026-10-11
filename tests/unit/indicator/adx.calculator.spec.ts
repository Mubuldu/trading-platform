import { Timeframe } from '../../../src/modules/indicator/domain/enums/timeframe.enum';
import {
  AdxCalculator,
  createAdxConfig,
} from '../../../src/modules/indicator/infrastructure/calculators/adx/adx.calculator';
import { AdxValue } from '../../../src/modules/indicator/domain/models/indicator-value.model';
import { makeCandle, resetTimestamp } from './helpers/candle.factory';
import { makeFakeHashService } from './helpers/fake-hash.service';

const PERIOD = 14;

function makeCalc() {
  return new AdxCalculator(
    createAdxConfig('BTC/USDT', Timeframe.ONE_MINUTE, PERIOD),
    makeFakeHashService(),
  );
}

beforeEach(() => resetTimestamp());

function makeTrendingCandles(
  count: number,
  direction: 'up' | 'down',
): ReturnType<typeof makeCandle>[] {
  const candles = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    price += direction === 'up' ? 2 : -2;
    candles.push(
      makeCandle({
        close: price,
        open: price - (direction === 'up' ? 1 : -1),
        high: price + 1,
        low: price - 3,
      }),
    );
  }
  return candles;
}

describe('AdxCalculator', () => {
  it('requires period * 2 warmup candles', () => {
    expect(makeCalc().getWarmupRequired()).toBe(PERIOD * 2);
  });

  it('is not warmed up with period * 2 - 1 candles', () => {
    const calc = makeCalc();
    calc.warmup(makeTrendingCandles(PERIOD * 2 - 1, 'up'));
    expect(calc.isWarmedUp()).toBe(false);
  });

  it('is warmed up after period * 2 candles', () => {
    const calc = makeCalc();
    calc.warmup(makeTrendingCandles(PERIOD * 2, 'up'));
    expect(calc.isWarmedUp()).toBe(true);
  });

  it('ADX, PDI, NDI are all non-negative', () => {
    const calc = makeCalc();
    calc.warmup(makeTrendingCandles(PERIOD * 2, 'up'));
    const result = calc.calculate();
    expect(result.isOk()).toBe(true);
    const v = (result as any).value as AdxValue;
    expect(v.adx).toBeGreaterThanOrEqual(0);
    expect(v.pdi).toBeGreaterThanOrEqual(0);
    expect(v.ndi).toBeGreaterThanOrEqual(0);
  });

  it('strong uptrend: PDI > NDI right after warmup', () => {
    const calc = makeCalc();
    // Warmup on a consistently rising market — PDI should dominate
    calc.warmup(makeTrendingCandles(PERIOD * 3, 'up'));
    const result = calc.calculate();
    const v = (result as any).value as AdxValue;
    expect(v.pdi).toBeGreaterThan(v.ndi);
  });

  it('strong downtrend: NDI > PDI right after warmup', () => {
    const calc = makeCalc();
    // Warmup on a consistently falling market — NDI should dominate
    calc.warmup(makeTrendingCandles(PERIOD * 3, 'down'));
    const result = calc.calculate();
    const v = (result as any).value as AdxValue;
    expect(v.ndi).toBeGreaterThan(v.pdi);
  });

  it('publishes JSON with adx, pdi, ndi fields', async () => {
    const hash = makeFakeHashService();
    const calc = new AdxCalculator(createAdxConfig('BTC/USDT', Timeframe.ONE_MINUTE, PERIOD), hash);
    calc.warmup(makeTrendingCandles(PERIOD * 2, 'up'));
    await calc.publish();
    const calls = hash.set.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const lastCall = calls[calls.length - 1];
    const parsed = JSON.parse(lastCall[2] as string);
    expect(parsed).toHaveProperty('adx');
    expect(parsed).toHaveProperty('pdi');
    expect(parsed).toHaveProperty('ndi');
  });

  it('resets state cleanly', () => {
    const calc = makeCalc();
    calc.warmup(makeTrendingCandles(PERIOD * 2, 'up'));
    calc.reset();
    expect(calc.isWarmedUp()).toBe(false);
    expect(calc.getCandlesProcessed()).toBe(0);
  });
});
