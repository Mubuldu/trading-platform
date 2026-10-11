import { DeadLetterService } from '@infrastructure/redis/streams/dead-letter.service';
import { RedisClientService } from '@infrastructure/redis/redis-client.service';
import { STREAM_NAMES } from '@infrastructure/redis/streams/stream-names.constants';
import { STREAM_SCHEMA_VERSION } from '@infrastructure/redis/streams/stream-event.interface';
import { AppLoggerService } from '@core/logging/app-logger.service';

describe('DeadLetterService', () => {
  let service: DeadLetterService;
  let xaddMock: jest.Mock;
  let xrevrangeMock: jest.Mock;
  let xlenMock: jest.Mock;

  beforeEach(() => {
    xaddMock = jest.fn().mockResolvedValue('dlq-1');
    xrevrangeMock = jest.fn().mockResolvedValue([]);
    xlenMock = jest.fn().mockResolvedValue(0);

    const redisClient = {
      getClient: () => ({
        xadd: xaddMock,
        xrevrange: xrevrangeMock,
        xlen: xlenMock,
      }),
    } as unknown as RedisClientService;

    const logger = {
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as AppLoggerService;

    service = new DeadLetterService(redisClient, logger);
  });

  const makeEvent = () => ({
    eventId: 'evt-1',
    correlationId: 'corr-1',
    eventType: 'market:tick',
    exchange: 'binance',
    symbol: 'BTCUSDT',
    timestamp: Date.now(),
    producer: 'test',
    schemaVersion: STREAM_SCHEMA_VERSION,
    payload: {},
    metadata: { retryCount: 3 },
  });

  it('publishes to dead letter stream', async () => {
    const id = await service.send(
      makeEvent(),
      'Max retries exceeded',
      'consumer-1',
      STREAM_NAMES.MARKET_TICK,
      '123-0',
    );
    expect(id).toBe('dlq-1');
    const [stream, maxlen, tilde, count, streamId] = xaddMock.mock.calls[0] as string[];
    expect(stream).toBe(STREAM_NAMES.DEAD_LETTER);
    expect(maxlen).toBe('MAXLEN');
    expect(tilde).toBe('~');
    expect(count).toBe('10000');
    expect(streamId).toBe('*');
  });

  it('stores the failure reason', async () => {
    await service.send(makeEvent(), 'Test failure reason', 'c1', STREAM_NAMES.MARKET_TICK, '0-1');
    const args = xaddMock.mock.calls[0] as string[];
    const failureReasonIdx = args.indexOf('failureReason');
    expect(args[failureReasonIdx + 1]).toBe('Test failure reason');
  });

  it('getCount delegates to xlen', async () => {
    xlenMock.mockResolvedValue(42);
    const count = await service.getCount();
    expect(count).toBe(42);
    expect(xlenMock).toHaveBeenCalledWith(STREAM_NAMES.DEAD_LETTER);
  });
});
