import { ConfigService } from '@nestjs/config';
import { Timeframe } from '../../../src/modules/indicator/domain/enums/timeframe.enum';
import { CandleValidatorService } from '../../../src/modules/indicator/infrastructure/validators/candle-validator.service';
import { Candle } from '../../../src/modules/indicator/domain/models/candle.model';

function makeConfigService(maxFutureSkewMs = 5000): jest.Mocked<ConfigService> {
  return {
    get: jest.fn().mockReturnValue({ maxFutureTimestampSkewMs: maxFutureSkewMs }),
  } as unknown as jest.Mocked<ConfigService>;
}

function makeValidator() {
  return new CandleValidatorService(makeConfigService());
}

const BASE_TIME = 1_700_000_000_000;
const INTERVAL = 60_000;

function makeCandle(overrides: Partial<Candle> = {}): Candle {
  return {
    symbol: 'BTC/USDT',
    exchange: 'BINANCE_SPOT',
    timeframe: Timeframe.ONE_MINUTE,
    openTime: BASE_TIME,
    closeTime: BASE_TIME + INTERVAL - 1,
    open: 100,
    high: 102,
    low: 98,
    close: 100,
    volume: 1,
    isClosed: true,
    ...overrides,
  };
}

describe('CandleValidatorService', () => {
  describe('OHLC validation', () => {
    it('accepts valid candle', () => {
      const validator = makeValidator();
      const result = validator.validate(makeCandle());
      expect(result.isOk()).toBe(true);
    });

    it('rejects candle with zero open', () => {
      const validator = makeValidator();
      const result = validator.validate(makeCandle({ open: 0 }));
      expect(result.isErr()).toBe(true);
    });

    it('rejects candle where high < low', () => {
      const validator = makeValidator();
      const result = validator.validate(makeCandle({ high: 95, low: 100 }));
      expect(result.isErr()).toBe(true);
    });

    it('rejects candle where high < close', () => {
      const validator = makeValidator();
      const result = validator.validate(makeCandle({ high: 99, close: 101, low: 98 }));
      expect(result.isErr()).toBe(true);
    });

    it('rejects candle where low > open', () => {
      const validator = makeValidator();
      const result = validator.validate(makeCandle({ low: 105, open: 100, close: 102, high: 106 }));
      expect(result.isErr()).toBe(true);
    });
  });

  describe('volume validation', () => {
    it('accepts zero volume', () => {
      const validator = makeValidator();
      const result = validator.validate(makeCandle({ volume: 0 }));
      expect(result.isOk()).toBe(true);
    });

    it('rejects negative volume', () => {
      const validator = makeValidator();
      const result = validator.validate(makeCandle({ volume: -1 }));
      expect(result.isErr()).toBe(true);
    });
  });

  describe('timestamp validation', () => {
    it('rejects future candle beyond skew threshold', () => {
      const validator = makeValidator();
      const futureTime = Date.now() + 100_000;
      const result = validator.validate(
        makeCandle({ openTime: futureTime, closeTime: futureTime + INTERVAL }),
      );
      expect(result.isErr()).toBe(true);
    });

    it('accepts candle within skew threshold', () => {
      const validator = makeValidator();
      const nearFutureTime = Date.now() + 1000;
      const result = validator.validate(
        makeCandle({ openTime: nearFutureTime, closeTime: nearFutureTime + INTERVAL }),
      );
      expect(result.isOk()).toBe(true);
    });

    it('rejects candle with closeTime <= openTime', () => {
      const validator = makeValidator();
      const result = validator.validate(makeCandle({ openTime: BASE_TIME, closeTime: BASE_TIME }));
      expect(result.isErr()).toBe(true);
    });
  });

  describe('duplicate detection', () => {
    it('rejects duplicate candle with same openTime', () => {
      const validator = makeValidator();
      const candle = makeCandle();
      validator.validate(candle);
      const result = validator.validate(candle);
      expect(result.isErr()).toBe(true);
      expect((result as any).error.message).toContain('Duplicate');
    });
  });

  describe('out-of-order detection', () => {
    it('rejects candle with earlier openTime than previous', () => {
      const validator = makeValidator();
      const c1 = makeCandle({
        openTime: BASE_TIME + INTERVAL,
        closeTime: BASE_TIME + INTERVAL * 2 - 1,
      });
      const c2 = makeCandle({ openTime: BASE_TIME, closeTime: BASE_TIME + INTERVAL - 1 });
      validator.validate(c1);
      const result = validator.validate(c2);
      expect(result.isErr()).toBe(true);
      expect((result as any).error.message).toContain('Out-of-order');
    });

    it('accepts candles in increasing order', () => {
      const validator = makeValidator();
      const c1 = makeCandle({ openTime: BASE_TIME, closeTime: BASE_TIME + INTERVAL - 1 });
      const c2 = makeCandle({
        openTime: BASE_TIME + INTERVAL,
        closeTime: BASE_TIME + INTERVAL * 2 - 1,
      });
      expect(validator.validate(c1).isOk()).toBe(true);
      expect(validator.validate(c2).isOk()).toBe(true);
    });
  });

  describe('resetContext', () => {
    it('allows duplicate after context reset', () => {
      const validator = makeValidator();
      const candle = makeCandle();
      validator.validate(candle);
      validator.resetContext('BTC/USDT', Timeframe.ONE_MINUTE);
      const result = validator.validate(candle);
      expect(result.isOk()).toBe(true);
    });

    it('allows out-of-order after context reset', () => {
      const validator = makeValidator();
      const c1 = makeCandle({
        openTime: BASE_TIME + INTERVAL,
        closeTime: BASE_TIME + INTERVAL * 2 - 1,
      });
      const c2 = makeCandle({ openTime: BASE_TIME, closeTime: BASE_TIME + INTERVAL - 1 });
      validator.validate(c1);
      validator.resetContext('BTC/USDT', Timeframe.ONE_MINUTE);
      const result = validator.validate(c2);
      expect(result.isOk()).toBe(true);
    });
  });
});
