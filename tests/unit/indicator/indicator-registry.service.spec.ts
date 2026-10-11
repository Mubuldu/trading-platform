import { Timeframe } from '../../../src/modules/indicator/domain/enums/timeframe.enum';
import { IndicatorRegistryService } from '../../../src/modules/indicator/infrastructure/registry/indicator-registry.service';
import {
  EmaCalculator,
  createEmaConfig,
} from '../../../src/modules/indicator/infrastructure/calculators/ema/ema.calculator';
import {
  AtrCalculator,
  createAtrConfig,
} from '../../../src/modules/indicator/infrastructure/calculators/atr/atr.calculator';
import { makeFakeHashService } from './helpers/fake-hash.service';
import { makeCandles, resetTimestamp } from './helpers/candle.factory';

function makeRegistry() {
  return new IndicatorRegistryService();
}

function makeEmaCalc(symbol = 'BTC/USDT', timeframe = Timeframe.ONE_MINUTE, period = 9) {
  return new EmaCalculator(createEmaConfig(symbol, timeframe, period), makeFakeHashService());
}

beforeEach(() => resetTimestamp());

describe('IndicatorRegistryService', () => {
  it('registers a calculator successfully', () => {
    const registry = makeRegistry();
    const calc = makeEmaCalc();
    const result = registry.register(calc);
    expect(result.isOk()).toBe(true);
    expect(registry.getAll()).toHaveLength(1);
  });

  it('returns error on duplicate registration', () => {
    const registry = makeRegistry();
    const calc = makeEmaCalc();
    registry.register(calc);
    const result = registry.register(calc);
    expect(result.isErr()).toBe(true);
    expect((result as any).error.message).toContain('already registered');
  });

  it('calls initialize() on registration', () => {
    const registry = makeRegistry();
    const calc = makeEmaCalc();
    const initSpy = jest.spyOn(calc, 'initialize');
    registry.register(calc);
    expect(initSpy).toHaveBeenCalledTimes(1);
  });

  it('get() returns the registered calculator', () => {
    const registry = makeRegistry();
    const calc = makeEmaCalc();
    registry.register(calc);
    const result = registry.get(calc.id);
    expect(result.isOk()).toBe(true);
    expect((result as any).value).toBe(calc);
  });

  it('get() returns error for unknown id', () => {
    const registry = makeRegistry();
    const result = registry.get('unknown:id');
    expect(result.isErr()).toBe(true);
    expect((result as any).error.message).toContain('not found');
  });

  it('remove() removes a registered calculator', () => {
    const registry = makeRegistry();
    const calc = makeEmaCalc();
    registry.register(calc);
    const result = registry.remove(calc.id);
    expect(result.isOk()).toBe(true);
    expect(registry.getAll()).toHaveLength(0);
  });

  it('remove() returns error for unknown id', () => {
    const registry = makeRegistry();
    const result = registry.remove('unknown:id');
    expect(result.isErr()).toBe(true);
  });

  it('getBySymbolAndTimeframe() filters correctly', () => {
    const registry = makeRegistry();
    const btcEma = makeEmaCalc('BTC/USDT', Timeframe.ONE_MINUTE, 9);
    const btcAtr = new AtrCalculator(
      createAtrConfig('BTC/USDT', Timeframe.ONE_MINUTE, 14),
      makeFakeHashService(),
    );
    const ethEma = makeEmaCalc('ETH/USDT', Timeframe.ONE_MINUTE, 9);
    registry.register(btcEma);
    registry.register(btcAtr);
    registry.register(ethEma);

    const btcCalcs = registry.getBySymbolAndTimeframe('BTC/USDT', Timeframe.ONE_MINUTE);
    expect(btcCalcs).toHaveLength(2);
    expect(btcCalcs.every((c) => c.config.symbol === 'BTC/USDT')).toBe(true);
  });

  it('getWarmupStatus() reflects warmed-up calculators', () => {
    const registry = makeRegistry();
    const calc = makeEmaCalc();
    registry.register(calc);

    let status = registry.getWarmupStatus();
    expect(status.total).toBe(1);
    expect(status.warmedUp).toBe(0);
    expect(status.allWarmedUp).toBe(false);
    expect(status.pending).toContain(calc.id);

    calc.warmup(makeCandles(9));

    status = registry.getWarmupStatus();
    expect(status.warmedUp).toBe(1);
    expect(status.allWarmedUp).toBe(true);
    expect(status.pending).toHaveLength(0);
  });

  it('getHealth() returns correct byType counts', () => {
    const registry = makeRegistry();
    registry.register(makeEmaCalc('BTC/USDT', Timeframe.ONE_MINUTE, 9));
    registry.register(makeEmaCalc('BTC/USDT', Timeframe.ONE_MINUTE, 21));
    registry.register(
      new AtrCalculator(
        createAtrConfig('BTC/USDT', Timeframe.ONE_MINUTE, 14),
        makeFakeHashService(),
      ),
    );

    const health = registry.getHealth();
    expect(health.totalRegistered).toBe(3);
    expect(health.byType['ema']).toBe(2);
    expect(health.byType['atr']).toBe(1);
    expect(health.indicators).toHaveLength(3);
  });

  it('getWarmupStatus() allWarmedUp is false with 0 indicators', () => {
    const registry = makeRegistry();
    const status = registry.getWarmupStatus();
    expect(status.allWarmedUp).toBe(false);
    expect(status.total).toBe(0);
  });
});
