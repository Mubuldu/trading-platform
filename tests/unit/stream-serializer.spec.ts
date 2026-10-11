import { StreamSerializerService } from '@infrastructure/redis/streams/stream-serializer.service';
import {
  StreamEvent,
  STREAM_SCHEMA_VERSION,
} from '@infrastructure/redis/streams/stream-event.interface';

const makeEvent = (overrides: Partial<StreamEvent> = {}): StreamEvent => ({
  eventId: 'test-event-id',
  correlationId: 'test-correlation-id',
  eventType: 'market:tick',
  exchange: 'binance',
  symbol: 'BTCUSDT',
  timestamp: 1700000000000,
  producer: 'binance-ws-stream-manager',
  schemaVersion: STREAM_SCHEMA_VERSION,
  payload: { price: 50000.5, volume: 1.5 },
  metadata: { retryCount: 0 },
  ...overrides,
});

describe('StreamSerializerService', () => {
  let serializer: StreamSerializerService;

  beforeEach(() => {
    serializer = new StreamSerializerService();
  });

  describe('serialize()', () => {
    it('converts event to flat string record', () => {
      const event = makeEvent();
      const result = serializer.serialize(event);

      expect(result['eventId']).toBe('test-event-id');
      expect(result['correlationId']).toBe('test-correlation-id');
      expect(result['eventType']).toBe('market:tick');
      expect(result['exchange']).toBe('binance');
      expect(result['symbol']).toBe('BTCUSDT');
      expect(result['timestamp']).toBe('1700000000000');
      expect(result['producer']).toBe('binance-ws-stream-manager');
      expect(result['schemaVersion']).toBe(STREAM_SCHEMA_VERSION);
      expect(result['format']).toBe('json');
    });

    it('serializes payload as JSON string', () => {
      const event = makeEvent({ payload: { price: 42, nested: { key: 'val' } } });
      const result = serializer.serialize(event);
      expect(JSON.parse(result['payload'])).toEqual({ price: 42, nested: { key: 'val' } });
    });

    it('serializes metadata as JSON string', () => {
      const event = makeEvent({ metadata: { retryCount: 2, sourceConsumer: 'test' } });
      const result = serializer.serialize(event);
      expect(JSON.parse(result['metadata'])).toEqual({ retryCount: 2, sourceConsumer: 'test' });
    });
  });

  describe('deserialize()', () => {
    it('round-trips an event through serialize → deserialize', () => {
      const original = makeEvent();
      const fields = serializer.serialize(original);
      const entry = { id: '1700000000000-0', fields };
      const restored = serializer.deserialize(entry);

      expect(restored.eventId).toBe(original.eventId);
      expect(restored.correlationId).toBe(original.correlationId);
      expect(restored.eventType).toBe(original.eventType);
      expect(restored.exchange).toBe(original.exchange);
      expect(restored.symbol).toBe(original.symbol);
      expect(restored.timestamp).toBe(original.timestamp);
      expect(restored.producer).toBe(original.producer);
      expect(restored.schemaVersion).toBe(original.schemaVersion);
      expect(restored.payload).toEqual(original.payload);
      expect(restored.metadata).toEqual(original.metadata);
    });

    it('throws on unsupported format', () => {
      const entry = {
        id: '0-0',
        fields: {
          format: 'msgpack',
          eventId: 'x',
          correlationId: 'x',
          eventType: 'x',
          exchange: 'x',
          symbol: 'x',
          timestamp: '0',
          producer: 'x',
          schemaVersion: '1.0.0',
          payload: '{}',
          metadata: '{}',
        },
      };
      expect(() => serializer.deserialize(entry)).toThrow('Unsupported serialization format');
    });
  });

  describe('parseRawEntry()', () => {
    it('converts flat array to field record', () => {
      const id = '1700000000000-0';
      const rawFields = ['eventId', 'abc', 'exchange', 'binance', 'format', 'json'];
      const entry = serializer.parseRawEntry(id, rawFields);
      expect(entry.id).toBe(id);
      expect(entry.fields['eventId']).toBe('abc');
      expect(entry.fields['exchange']).toBe('binance');
    });
  });
});
