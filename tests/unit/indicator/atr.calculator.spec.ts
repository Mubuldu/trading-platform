import { Timeframe } from '../../../src/modules/indicator/domain/enums/timeframe.enum';
import { IndicatorState } from '../../../src/modules/indicator/domain/enums/indicator-state.enum';
import {
  AtrCalculator,
  createAtrConfig,
} from '../../../src/modules/indicator/infrastructure/calculators/atr/atr.calculator';
import { AtrValue } from '../../../src/modules/indicator/domain/models/indicator-value.model';
import { makeCandle, makeCandles, resetTimestamp } from './helpers/candle.factory';
import { makeFakeHashService } from './helpers/fake-hash.service';

const PERIOD = 14;

function makeCalc() {
  return new AtrCalculator(
    createAtrConfig('BTC/USDT', Timeframe.ONE_MINUTE, PERIOD),
    makeFakeHashService(),
  );
}

beforeEach(() => resetTimestamp());

describe('AtrCalculator', () => {
  it('requires period + 1 candles to warm up', () => {
    expect(makeCalc().getWarmupRequired()).toBe(PERIOD + 1);
  });

  it('not warmed up with period candles', () => {
    const calc = makeCalc();
    calc.warmup(makeCandles(PERIOD));
    expect(calc.isWarmedUp()).toBe(false);
  });

  it('warmed up after period + 1 candles', () => {
    const calc = makeCalc();
    calc.warmup(makeCandles(PERIOD + 1));
    expect(calc.isWarmedUp()).toBe(true);
  });

  it('computes ATR using high - low for first candle (no prev close)', () => {
    const calc = makeCalc();
    // All candles: high=102, low=98, close=100 в†’ TR = 4 for all
    const candles = makeCandles(PERIOD + 1, { open: 100, high: 102, low: 98, close: 100 });
    calc.warmup(candles);
    const result = calc.calculate();
    expect(result.isOk()).toBe(true);
    expect(((result as any).value as AtrValue).value).toBeCloseTo(4, 5);
  });

  it('applies Wilders smoothing after seed', () => {
    const calc = makeCalc();
    const candles = makeCandles(PERIOD + 1, { open: 100, high: 102, low: 98, close: 100 });
    calc.warmup(candles);
    // New candle with bigger range
    calc.update(makeCandle({ open: 100, high: 110, low: 90, close: 100 }));
    const result = calc.calculate();
    // Wilder: (prev * (N-1) + newTR) / N
    const expected = (4 * (PERIOD - 1) + 20) / PERIOD;
    expect(((result as any).value as AtrValue).value).toBeCloseTo(expected, 5);
  });

  it('publishes numeric value to indicator:atr', async () => {
    const hash = makeFakeHashService();
    const calc = new AtrCalculator(createAtrConfig('BTC/USDT', Timeframe.ONE_MINUTE, PERIOD), hash);
    calc.warmup(makeCandles(PERIOD + 1, { open: 100, high: 102, low: 98, close: 100 }));
    await calc.publish();
    expect(hash.set).toHaveBeenCalledWith('indicator:atr', expect.any(String), expect.any(Number));
  });

  it('ATR is always non-negative', () => {
    const calc = makeCalc();
    calc.warmup(makeCandles(PERIOD + 1, { open: 100, high: 102, low: 98, close: 100 }));
    const result = calc.calculate();
    expect(((result as any).value as AtrValue).value).toBeGreaterThanOrEqual(0);
  });

  it('state is IDLE after reset', () => {
    const calc = makeCalc();
    calc.warmup(makeCandles(PERIOD + 1));
    calc.reset();
    expect(calc.state).toBe(IndicatorState.IDLE);
  });
});
