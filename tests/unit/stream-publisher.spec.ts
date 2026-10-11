import {
  StreamPublisherService,
  PublishEventInput,
} from '@infrastructure/redis/streams/stream-publisher.service';
import { StreamSerializerService } from '@infrastructure/redis/streams/stream-serializer.service';
import { StreamValidatorService } from '@infrastructure/redis/streams/stream-validator.service';
import { STREAM_NAMES } from '@infrastructure/redis/streams/stream-names.constants';
import { STREAM_SCHEMA_VERSION } from '@infrastructure/redis/streams/stream-event.interface';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { ConfigService } from '@nestjs/config';
import { RedisClientService } from '@infrastructure/redis/redis-client.service';

const makeInput = (overrides: Partial<PublishEventInput> = {}): PublishEventInput => ({
  eventType: 'market:tick',
  exchange: 'binance',
  symbol: 'BTCUSDT',
  timestamp: Date.now(),
  producer: 'test-producer',
  correlationId: 'corr-id',
  payload: { price: 50000 },
  ...overrides,
});

describe('StreamPublisherService', () => {
  let publisher: StreamPublisherService;
  let xaddMock: jest.Mock;

  beforeEach(() => {
    xaddMock = jest.fn().mockResolvedValue('1700000000000-0');

    const redisClient = {
      getClient: () => ({ xadd: xaddMock, xlen: jest.fn().mockResolvedValue(5) }),
    } as unknown as RedisClientService;

    const config = {
      get: jest.fn().mockReturnValue({
        streams: { maxLen: 100_000, approximateMaxLen: true },
      }),
    } as unknown as ConfigService;

    const logger = {
      debug: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as AppLoggerService;

    publisher = new StreamPublisherService(
      redisClient,
      new StreamSerializerService(),
      new StreamValidatorService(),
      config,
      logger,
    );
  });

  it('returns a stream ID on successful publish', async () => {
    const id = await publisher.publish(STREAM_NAMES.MARKET_TICK, makeInput());
    expect(id).toBe('1700000000000-0');
  });

  it('calls XADD with MAXLEN ~ for approximate trim', async () => {
    await publisher.publish(STREAM_NAMES.MARKET_TICK, makeInput());
    const [stream, maxlen, tilde, count, id] = xaddMock.mock.calls[0] as string[];
    expect(stream).toBe(STREAM_NAMES.MARKET_TICK);
    expect(maxlen).toBe('MAXLEN');
    expect(tilde).toBe('~');
    expect(count).toBe('100000');
    expect(id).toBe('*');
  });

  it('adds schemaVersion and eventId automatically', async () => {
    await publisher.publish(STREAM_NAMES.MARKET_TICK, makeInput());
    const callArgs = xaddMock.mock.calls[0] as string[];
    const flatFields = callArgs.slice(5);
    const fieldMap: Record<string, string> = {};
    for (let i = 0; i < flatFields.length - 1; i += 2) {
      fieldMap[flatFields[i]] = flatFields[i + 1];
    }
    expect(fieldMap['schemaVersion']).toBe(STREAM_SCHEMA_VERSION);
    expect(fieldMap['eventId']).toBeDefined();
  });

  it('throws on invalid event', async () => {
    await expect(
      publisher.publish(STREAM_NAMES.MARKET_TICK, makeInput({ exchange: '' })),
    ).rejects.toThrow('Invalid stream event');
  });

  it('publishBatch publishes multiple events in order', async () => {
    const inputs = [makeInput(), makeInput({ symbol: 'ETHUSDT' })];
    const ids = await publisher.publishBatch(STREAM_NAMES.MARKET_TICK, inputs);
    expect(ids).toHaveLength(2);
    expect(xaddMock).toHaveBeenCalledTimes(2);
  });
});
