import { AbstractMapper } from '@modules/exchange/mappers/base.mapper';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { ExchangeInvalidRequestError } from '@modules/exchange/errors/exchange.error';
import { Result, ok, err } from '@common/result';
import { ExchangeError } from '@modules/exchange/errors/exchange.error';

interface RawTrade {
  id: string;
  price: string;
  quantity: string;
  time: string | number;
  [key: string]: unknown;
}

interface NormalizedTrade {
  tradeId: string;
  price: number;
  quantity: number;
  time: Date;
}

/**
 * Minimal concrete mapper used to exercise the AbstractMapper base.
 * Wraps the protected helpers so the test suite can call them directly.
 */
class TradeMapper extends AbstractMapper<RawTrade, NormalizedTrade> {
  readonly exchangeId = ExchangeId.PAPER_TRADING;

  map(raw: RawTrade): Result<NormalizedTrade, ExchangeError> {
    const priceResult = this.parseFloat(raw.price, 'price');
    if (priceResult.isErr()) return err(priceResult.error);

    const qtyResult = this.parseFloat(raw.quantity, 'quantity');
    if (qtyResult.isErr()) return err(qtyResult.error);

    const timeResult = this.parseDate(raw.time, 'time');
    if (timeResult.isErr()) return err(timeResult.error);

    return ok({
      tradeId: raw.id,
      price: priceResult.value,
      quantity: qtyResult.value,
      time: timeResult.value,
    });
  }

  // Expose protected helpers for direct unit tests
  testRequireField<T>(obj: Record<string, unknown>, field: string) {
    return this.requireField<T>(obj, field);
  }

  testParseFloat(value: unknown, field: string) {
    return this.parseFloat(value, field);
  }

  testParseDate(value: unknown, field: string) {
    return this.parseDate(value, field);
  }
}

const MAPPER = new TradeMapper();

const validRaw: RawTrade = {
  id: 'T001',
  price: '50000.50',
  quantity: '0.001',
  time: '1700000000000',
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe('AbstractMapper', () => {
  describe('map() — single item', () => {
    it('maps a valid raw item to a normalized model', () => {
      const result = MAPPER.map(validRaw);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.tradeId).toBe('T001');
        expect(result.value.price).toBe(50000.5);
        expect(result.value.quantity).toBe(0.001);
        expect(result.value.time).toBeInstanceOf(Date);
      }
    });

    it('returns ExchangeInvalidRequestError for malformed price', () => {
      const result = MAPPER.map({ ...validRaw, price: 'not-a-number' });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error).toBeInstanceOf(ExchangeInvalidRequestError);
    });

    it('returns ExchangeInvalidRequestError for malformed timestamp', () => {
      const result = MAPPER.map({ ...validRaw, time: 'bad-date' });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error).toBeInstanceOf(ExchangeInvalidRequestError);
    });
  });

  describe('mapMany() — collection', () => {
    it('maps an array of valid items', () => {
      const raw = [validRaw, { ...validRaw, id: 'T002' }];
      const result = MAPPER.mapMany(raw);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0].tradeId).toBe('T001');
        expect(result.value[1].tradeId).toBe('T002');
      }
    });

    it('returns the first error encountered without processing remaining items', () => {
      const raw = [
        { ...validRaw, id: 'T001' },
        { ...validRaw, id: 'T002', price: 'NaN' }, // error
        { ...validRaw, id: 'T003' },
      ];
      const result = MAPPER.mapMany(raw);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(ExchangeInvalidRequestError);
        expect(result.error.message).toContain('price');
      }
    });

    it('returns an empty array for an empty input', () => {
      const result = MAPPER.mapMany([]);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) expect(result.value).toHaveLength(0);
    });
  });

  describe('requireField()', () => {
    it('returns the value when the field is present', () => {
      const result = MAPPER.testRequireField<string>({ name: 'BTC' }, 'name');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) expect(result.value).toBe('BTC');
    });

    it('returns ExchangeInvalidRequestError when field is undefined', () => {
      const result = MAPPER.testRequireField<string>({ other: 'x' }, 'missing');
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(ExchangeInvalidRequestError);
        expect(result.error.message).toContain('"missing"');
      }
    });

    it('returns ExchangeInvalidRequestError when field is null', () => {
      const result = MAPPER.testRequireField<string>({ field: null }, 'field');
      expect(result.isErr()).toBe(true);
    });

    it('includes available keys in the error for diagnostics', () => {
      const result = MAPPER.testRequireField<string>({ a: 1, b: 2 }, 'c');
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        const details = result.error.details as { receivedKeys: string[] } | undefined;
        expect(details?.receivedKeys).toContain('a');
        expect(details?.receivedKeys).toContain('b');
      }
    });
  });

  describe('parseFloat()', () => {
    it('parses a numeric string', () => {
      const result = MAPPER.testParseFloat('12345.678', 'price');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) expect(result.value).toBeCloseTo(12345.678);
    });

    it('parses a number value directly', () => {
      const result = MAPPER.testParseFloat(42.5, 'qty');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) expect(result.value).toBe(42.5);
    });

    it('parses zero correctly', () => {
      const result = MAPPER.testParseFloat('0', 'price');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) expect(result.value).toBe(0);
    });

    it('returns error for non-numeric string', () => {
      const result = MAPPER.testParseFloat('abc', 'price');
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(ExchangeInvalidRequestError);
        expect(result.error.message).toContain('"price"');
      }
    });

    it('returns error for empty string', () => {
      const result = MAPPER.testParseFloat('', 'price');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('parseDate()', () => {
    it('parses a unix millisecond timestamp string', () => {
      const result = MAPPER.testParseDate('1700000000000', 'time');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeInstanceOf(Date);
        expect(result.value.getTime()).toBe(1700000000000);
      }
    });

    it('parses a numeric timestamp directly', () => {
      const result = MAPPER.testParseDate(1700000000000, 'time');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) expect(result.value.getTime()).toBe(1700000000000);
    });

    it('returns error for non-numeric timestamp string', () => {
      const result = MAPPER.testParseDate('2024-01-01T00:00:00Z', 'time');
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(ExchangeInvalidRequestError);
        expect(result.error.message).toContain('"time"');
      }
    });

    it('returns error for undefined timestamp', () => {
      const result = MAPPER.testParseDate(undefined, 'time');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('exchangeId attribution', () => {
    it('all errors carry the correct exchangeId', () => {
      const result = MAPPER.map({ ...validRaw, price: 'bad' });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect((result.error as ExchangeInvalidRequestError).exchangeId).toBe(
          ExchangeId.PAPER_TRADING,
        );
      }
    });
  });
});
