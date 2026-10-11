import { Timeframe } from '../../../src/modules/indicator/domain/enums/timeframe.enum';
import {
  VwapCalculator,
  createVwapConfig,
} from '../../../src/modules/indicator/infrastructure/calculators/vwap/vwap.calculator';
import { VwapValue } from '../../../src/modules/indicator/domain/models/indicator-value.model';
import { makeCandle, resetTimestamp } from './helpers/candle.factory';
import { makeFakeHashService } from './helpers/fake-hash.service';

function makeCalc() {
  return new VwapCalculator(
    createVwapConfig('BTC/USDT', Timeframe.ONE_MINUTE),
    makeFakeHashService(),
  );
}

beforeEach(() => resetTimestamp());

describe('VwapCalculator', () => {
  it('requires only 1 candle to warm up', () => {
    expect(makeCalc().getWarmupRequired()).toBe(1);
  });

  it('warmed up after 1 candle', () => {
    const calc = makeCalc();
    calc.warmup([makeCandle({ open: 100, high: 102, low: 98, close: 100, volume: 10 })]);
    expect(calc.isWarmedUp()).toBe(true);
  });

  it('VWAP = TP when only one candle', () => {
    const calc = makeCalc();
    calc.warmup([makeCandle({ open: 100, high: 106, low: 94, close: 100, volume: 10 })]);
    // TP = (106 + 94 + 100) / 3 = 100
    const result = calc.calculate();
    expect(result.isOk()).toBe(true);
    expect(((result as any).value as VwapValue).value).toBeCloseTo(100, 5);
  });

  it('VWAP is volume-weighted average of TP', () => {
    const calc = makeCalc();
    // TP1 = (105+95+100)/3 = 100, volume=10 в†’ TPV=1000
    // TP2 = (110+90+110)/3 в‰€ 103.33, volume=5 в†’ TPVв‰€516.67
    // VWAP = (1000+516.67)/15 в‰€ 101.11
    const c1 = makeCandle({ open: 100, high: 105, low: 95, close: 100, volume: 10 });
    const c2 = makeCandle({ open: 100, high: 110, low: 90, close: 110, volume: 5 });
    calc.warmup([c1]);
    calc.update(c2);
    const result = calc.calculate();
    const tp1 = (105 + 95 + 100) / 3;
    const tp2 = (110 + 90 + 110) / 3;
    const expected = (tp1 * 10 + tp2 * 5) / 15;
    expect(((result as any).value as VwapValue).value).toBeCloseTo(expected, 5);
  });

  it('resets session at UTC date change', () => {
    const calc = makeCalc();
    const day1 = new Date('2024-01-01T23:59:00Z').getTime();
    const day2 = new Date('2024-01-02T00:01:00Z').getTime();
    const INTERVAL = 60_000;

    calc.warmup([
      makeCandle({
        open: 100,
        high: 200,
        low: 100,
        close: 200,
        volume: 100,
        openTime: day1,
        closeTime: day1 + INTERVAL - 1,
      }),
    ]);
    calc.update(
      makeCandle({
        open: 100,
        high: 102,
        low: 98,
        close: 100,
        volume: 1,
        openTime: day2,
        closeTime: day2 + INTERVAL - 1,
      }),
    );
    const result = calc.calculate();
    // After reset, VWAP should be just from day2 candle
    const tp = (102 + 98 + 100) / 3;
    expect(((result as any).value as VwapValue).value).toBeCloseTo(tp, 5);
  });

  it('publishes to indicator:vwap', async () => {
    const hash = makeFakeHashService();
    const calc = new VwapCalculator(createVwapConfig('BTC/USDT', Timeframe.ONE_MINUTE), hash);
    calc.warmup([makeCandle({ open: 100, high: 102, low: 98, close: 100, volume: 10 })]);
    await calc.publish();
    expect(hash.set).toHaveBeenCalledWith('indicator:vwap', expect.any(String), expect.any(Number));
  });

  it('VWAP is 0 when cumulative volume is 0', () => {
    const calc = makeCalc();
    calc.warmup([makeCandle({ open: 100, high: 102, low: 98, close: 100, volume: 0 })]);
    const result = calc.calculate();
    expect(((result as any).value as VwapValue).value).toBe(0);
  });
});
