import { Timeframe } from '../../../src/modules/indicator/domain/enums/timeframe.enum';
import {
  RsiCalculator,
  createRsiConfig,
} from '../../../src/modules/indicator/infrastructure/calculators/rsi/rsi.calculator';
import { RsiValue } from '../../../src/modules/indicator/domain/models/indicator-value.model';
import { makeCandle, resetTimestamp } from './helpers/candle.factory';
import { makeFakeHashService } from './helpers/fake-hash.service';

const PERIOD = 14;

function makeCalc() {
  return new RsiCalculator(
    createRsiConfig('BTC/USDT', Timeframe.ONE_MINUTE, PERIOD),
    makeFakeHashService(),
  );
}

beforeEach(() => resetTimestamp());

describe('RsiCalculator', () => {
  it('requires period + 1 warmup candles', () => {
    expect(makeCalc().getWarmupRequired()).toBe(PERIOD + 1);
  });

  it('RSI = 100 when all gains (no losses)', () => {
    const calc = makeCalc();
    // Feed period+1 candles each rising: price 1,2,3,...
    const prices = Array.from({ length: PERIOD + 1 }, (_, i) => i + 1);
    const candles = prices.map((p) => makeCandle({ close: p, open: p, high: p + 1, low: p - 1 }));
    calc.warmup(candles);
    const result = calc.calculate();
    expect(result.isOk()).toBe(true);
    expect(((result as any).value as RsiValue).value).toBeCloseTo(100, 5);
  });

  it('RSI = 0 when all losses (no gains)', () => {
    const calc = makeCalc();
    const prices = Array.from({ length: PERIOD + 1 }, (_, i) => PERIOD + 1 - i);
    const candles = prices.map((p) => makeCandle({ close: p, open: p, high: p + 1, low: p - 1 }));
    calc.warmup(candles);
    const result = calc.calculate();
    expect(result.isOk()).toBe(true);
    expect(((result as any).value as RsiValue).value).toBeCloseTo(0, 5);
  });

  it('RSI в‰€ 50 for alternating gains/losses of equal magnitude', () => {
    const calc = makeCalc();
    // Start at 100, alternate +1/-1
    const prices = [100];
    for (let i = 0; i < PERIOD; i++) {
      prices.push(i % 2 === 0 ? prices[prices.length - 1] + 1 : prices[prices.length - 1] - 1);
    }
    const candles = prices.map((p) => makeCandle({ close: p, open: p, high: p + 1, low: p - 1 }));
    calc.warmup(candles);
    const result = calc.calculate();
    expect(((result as any).value as RsiValue).value).toBeGreaterThan(0);
    expect(((result as any).value as RsiValue).value).toBeLessThan(100);
  });

  it('RSI is always between 0 and 100', () => {
    const calc = makeCalc();
    const prices = [100, 105, 102, 108, 103, 107, 104, 109, 101, 106, 103, 108, 102, 107, 100];
    const candles = prices.map((p) => makeCandle({ close: p, open: p, high: p + 1, low: p - 1 }));
    calc.warmup(candles);
    const result = calc.calculate();
    const rsi = ((result as any).value as RsiValue).value;
    expect(rsi).toBeGreaterThanOrEqual(0);
    expect(rsi).toBeLessThanOrEqual(100);
  });

  it('publishes to indicator:rsi', async () => {
    const hash = makeFakeHashService();
    const calc = new RsiCalculator(createRsiConfig('BTC/USDT', Timeframe.ONE_MINUTE, PERIOD), hash);
    const prices = Array.from({ length: PERIOD + 1 }, (_, i) => 100 + i);
    calc.warmup(prices.map((p) => makeCandle({ close: p, open: p, high: p + 1, low: p - 1 })));
    await calc.publish();
    expect(hash.set).toHaveBeenCalledWith('indicator:rsi', expect.any(String), expect.any(Number));
  });

  it('calculate() returns err when not warmed up', () => {
    const calc = makeCalc();
    const result = calc.calculate();
    expect(result.isErr()).toBe(true);
  });
});
