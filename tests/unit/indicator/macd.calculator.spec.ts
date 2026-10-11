import { Timeframe } from '../../../src/modules/indicator/domain/enums/timeframe.enum';
import {
  MacdCalculator,
  createMacdConfig,
} from '../../../src/modules/indicator/infrastructure/calculators/macd/macd.calculator';
import { MacdValue } from '../../../src/modules/indicator/domain/models/indicator-value.model';
import { makeCandle, resetTimestamp } from './helpers/candle.factory';
import { makeFakeHashService } from './helpers/fake-hash.service';

const SLOW = 26;
const SIGNAL = 9;

function makeCalc() {
  return new MacdCalculator(
    createMacdConfig('BTC/USDT', Timeframe.ONE_MINUTE),
    makeFakeHashService(),
  );
}

beforeEach(() => resetTimestamp());

function makeWarmupCandles(count: number, price = 100) {
  return Array.from({ length: count }, () =>
    makeCandle({ close: price, open: price, high: price + 1, low: price - 1 }),
  );
}

describe('MacdCalculator', () => {
  it('requires slowPeriod + signalPeriod candles', () => {
    expect(makeCalc().getWarmupRequired()).toBe(SLOW + SIGNAL);
  });

  it('not warmed up before slowPeriod + signalPeriod candles', () => {
    const calc = makeCalc();
    calc.warmup(makeWarmupCandles(SLOW + SIGNAL - 1));
    expect(calc.isWarmedUp()).toBe(false);
  });

  it('warmed up after slowPeriod + signalPeriod candles', () => {
    const calc = makeCalc();
    calc.warmup(makeWarmupCandles(SLOW + SIGNAL));
    expect(calc.isWarmedUp()).toBe(true);
  });

  it('MACD в‰€ 0 when price is constant', () => {
    const calc = makeCalc();
    calc.warmup(makeWarmupCandles(SLOW + SIGNAL, 100));
    const result = calc.calculate();
    expect(result.isOk()).toBe(true);
    const v = (result as any).value as MacdValue;
    expect(v.macd).toBeCloseTo(0, 5);
    expect(v.signal).toBeCloseTo(0, 5);
    expect(v.histogram).toBeCloseTo(0, 5);
  });

  it('histogram = macd - signal', () => {
    const calc = makeCalc();
    calc.warmup(makeWarmupCandles(SLOW + SIGNAL, 100));
    // Spike in price to create divergence
    calc.update(makeCandle({ close: 200, open: 200, high: 201, low: 199 }));
    const result = calc.calculate();
    const v = (result as any).value as MacdValue;
    expect(v.histogram).toBeCloseTo(v.macd - v.signal, 8);
  });

  it('uptrend: fast EMA above slow EMA в†’ positive MACD', () => {
    const calc = makeCalc();
    // Start flat then trend up strongly
    calc.warmup(makeWarmupCandles(SLOW + SIGNAL, 100));
    for (let i = 0; i < 10; i++) {
      calc.update(makeCandle({ close: 200 + i * 10, open: 190, high: 210, low: 185 }));
    }
    const result = calc.calculate();
    const v = (result as any).value as MacdValue;
    expect(v.macd).toBeGreaterThan(0);
  });

  it('publishes JSON with macd, signal, histogram', async () => {
    const hash = makeFakeHashService();
    const calc = new MacdCalculator(createMacdConfig('BTC/USDT', Timeframe.ONE_MINUTE), hash);
    calc.warmup(makeWarmupCandles(SLOW + SIGNAL));
    await calc.publish();
    const lastCall = hash.set.mock.calls[hash.set.mock.calls.length - 1];
    const parsed = JSON.parse(lastCall[2] as string);
    expect(parsed).toHaveProperty('macd');
    expect(parsed).toHaveProperty('signal');
    expect(parsed).toHaveProperty('histogram');
  });

  it('state returns err before warmup', () => {
    const calc = makeCalc();
    expect(calc.calculate().isErr()).toBe(true);
  });
});
