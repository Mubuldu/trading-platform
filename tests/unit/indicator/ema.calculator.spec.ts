import { Timeframe } from '../../../src/modules/indicator/domain/enums/timeframe.enum';
import { IndicatorState } from '../../../src/modules/indicator/domain/enums/indicator-state.enum';
import {
  EmaCalculator,
  createEmaConfig,
} from '../../../src/modules/indicator/infrastructure/calculators/ema/ema.calculator';
import { EmaValue } from '../../../src/modules/indicator/domain/models/indicator-value.model';
import { makeCandle, makeCandles, resetTimestamp } from './helpers/candle.factory';
import { makeFakeHashService } from './helpers/fake-hash.service';

const PERIOD = 9;

function makeCalc() {
  return new EmaCalculator(
    createEmaConfig('BTC/USDT', Timeframe.ONE_MINUTE, PERIOD),
    makeFakeHashService(),
  );
}

beforeEach(() => resetTimestamp());

describe('EmaCalculator', () => {
  it('starts in IDLE state', () => {
    const calc = makeCalc();
    expect(calc.state).toBe(IndicatorState.IDLE);
    expect(calc.isWarmedUp()).toBe(false);
  });

  it('transitions to READY after exactly period candles on warmup', () => {
    const calc = makeCalc();
    calc.warmup(makeCandles(PERIOD));
    expect(calc.state).toBe(IndicatorState.READY);
    expect(calc.isWarmedUp()).toBe(true);
  });

  it('stays not warmed up with fewer than period candles', () => {
    const calc = makeCalc();
    calc.warmup(makeCandles(PERIOD - 1));
    expect(calc.isWarmedUp()).toBe(false);
  });

  it('computes SMA seed as initial EMA value', () => {
    const calc = makeCalc();
    const price = 50;
    calc.warmup(
      makeCandles(PERIOD, { close: price, open: price, high: price + 1, low: price - 1 }),
    );
    const result = calc.calculate();
    expect(result.isOk()).toBe(true);
    expect(((result as any).value as EmaValue).value).toBeCloseTo(price, 6);
  });

  it('applies EMA formula after seed', () => {
    const calc = makeCalc();
    calc.warmup(makeCandles(PERIOD, { close: 100, open: 100, high: 101, low: 99 }));
    const k = 2 / (PERIOD + 1);
    const newPrice = 110;
    calc.update(
      makeCandle({ close: newPrice, open: newPrice, high: newPrice + 1, low: newPrice - 1 }),
    );
    const result = calc.calculate();
    expect(result.isOk()).toBe(true);
    const expected = newPrice * k + 100 * (1 - k);
    expect(((result as any).value as EmaValue).value).toBeCloseTo(expected, 6);
  });

  it('does not publish before warmup', async () => {
    const hash = makeFakeHashService();
    const calc = new EmaCalculator(createEmaConfig('BTC/USDT', Timeframe.ONE_MINUTE, PERIOD), hash);
    await calc.publish();
    expect(hash.set).not.toHaveBeenCalled();
  });

  it('publishes to Redis after warmup', async () => {
    const hash = makeFakeHashService();
    const calc = new EmaCalculator(createEmaConfig('BTC/USDT', Timeframe.ONE_MINUTE, PERIOD), hash);
    calc.warmup(makeCandles(PERIOD, { close: 100, open: 100, high: 101, low: 99 }));
    await calc.publish();
    expect(hash.set).toHaveBeenCalledWith('indicator:ema', expect.any(String), expect.any(Number));
  });

  it('reset clears state and disables warmup', () => {
    const calc = makeCalc();
    calc.warmup(makeCandles(PERIOD));
    calc.reset();
    expect(calc.isWarmedUp()).toBe(false);
    expect(calc.getCandlesProcessed()).toBe(0);
  });

  it('can re-warmup after reset', () => {
    const calc = makeCalc();
    calc.warmup(makeCandles(PERIOD));
    calc.reset();
    calc.warmup(makeCandles(PERIOD));
    expect(calc.isWarmedUp()).toBe(true);
  });

  it('returns unique IDs per config', () => {
    const a = makeCalc();
    const b = new EmaCalculator(
      createEmaConfig('ETH/USDT', Timeframe.ONE_MINUTE, PERIOD),
      makeFakeHashService(),
    );
    expect(a.id).not.toBe(b.id);
  });

  it('getHealth returns correct fields', () => {
    const calc = makeCalc();
    calc.warmup(makeCandles(PERIOD));
    const h = calc.getHealth();
    expect(h.warmupRequired).toBe(PERIOD);
    expect(h.state).toBe(IndicatorState.READY);
    expect(h.candlesProcessed).toBe(PERIOD);
  });
});
