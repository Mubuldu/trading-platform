import { StreamValidatorService } from '@infrastructure/redis/streams/stream-validator.service';
import {
  StreamEvent,
  STREAM_SCHEMA_VERSION,
} from '@infrastructure/redis/streams/stream-event.interface';

const makeEvent = (overrides: Partial<StreamEvent> = {}): StreamEvent => ({
  eventId: 'evt-id',
  correlationId: 'corr-id',
  eventType: 'market:tick',
  exchange: 'binance',
  symbol: 'BTCUSDT',
  timestamp: Date.now(),
  producer: 'test-producer',
  schemaVersion: STREAM_SCHEMA_VERSION,
  payload: { price: 1000 },
  metadata: { retryCount: 0 },
  ...overrides,
});

describe('StreamValidatorService', () => {
  let validator: StreamValidatorService;

  beforeEach(() => {
    validator = new StreamValidatorService();
  });

  describe('validate()', () => {
    it('passes a valid event', () => {
      const result = validator.validate(makeEvent());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects missing eventId', () => {
      const result = validator.validate(makeEvent({ eventId: '' }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('eventId is required');
    });

    it('rejects missing correlationId', () => {
      const result = validator.validate(makeEvent({ correlationId: '' }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('correlationId is required');
    });

    it('rejects missing eventType', () => {
      const result = validator.validate(makeEvent({ eventType: '' }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('eventType is required');
    });

    it('rejects missing exchange', () => {
      const result = validator.validate(makeEvent({ exchange: '' }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('exchange is required');
    });

    it('rejects missing symbol', () => {
      const result = validator.validate(makeEvent({ symbol: '' }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('symbol is required');
    });

    it('rejects zero timestamp', () => {
      const result = validator.validate(makeEvent({ timestamp: 0 }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('timestamp must be a positive number');
    });

    it('rejects future timestamp beyond 5 minutes', () => {
      const farFuture = Date.now() + 10 * 60 * 1000;
      const result = validator.validate(makeEvent({ timestamp: farFuture }));
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('too far in the future'))).toBe(true);
    });

    it('rejects stale timestamp older than 1 hour', () => {
      const oldTime = Date.now() - 2 * 60 * 60 * 1000;
      const result = validator.validate(makeEvent({ timestamp: oldTime }));
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('too old'))).toBe(true);
    });

    it('rejects unknown schemaVersion', () => {
      const result = validator.validate(makeEvent({ schemaVersion: '99.0.0' }));
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('not supported'))).toBe(true);
    });

    it('rejects null payload', () => {
      const result = validator.validate(
        makeEvent({ payload: null as unknown as Record<string, unknown> }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('payload must be an object');
    });

    it('collects multiple errors', () => {
      const result = validator.validate(makeEvent({ eventId: '', exchange: '', symbol: '' }));
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('validatePartial()', () => {
    it('passes with all required fields', () => {
      const fields = {
        eventId: 'e',
        correlationId: 'c',
        eventType: 't',
        exchange: 'binance',
        symbol: 'BTC',
        timestamp: '1700000000000',
        producer: 'p',
        schemaVersion: '1.0.0',
        payload: '{}',
      };
      const result = validator.validatePartial(fields);
      expect(result.valid).toBe(true);
    });

    it('fails with missing required field', () => {
      const fields = {
        eventId: 'e',
        correlationId: 'c',
        eventType: 't',
        exchange: '',
      };
      const result = validator.validatePartial(fields);
      expect(result.valid).toBe(false);
    });
  });
});
