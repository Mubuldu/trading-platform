import { RetryManagerService } from '../../../src/modules/execution/application/services/retry-manager.service';
import { ExchangeId } from '../../../src/modules/exchange/enums/exchange.enums';
import {
  OrderSide,
  OrderType,
  OrderStatus,
  TimeInForce,
} from '../../../src/modules/exchange/enums/order.enums';

function makeOrder(overrides = {}) {
  return {
    exchangeOrderId: 'ex-1',
    clientOrderId: 'cl-1',
    side: OrderSide.BUY,
    type: OrderType.MARKET,
    status: OrderStatus.FILLED,
    originalQuantity: 0.1,
    executedQuantity: 0.1,
    remainingQuantity: 0,
    cumulativeQuoteQuantity: 5000,
    price: 0,
    averagePrice: 50_000,
    timeInForce: TimeInForce.GTC,
    symbol: 'BTC/USDT',
    exchangeId: ExchangeId.PAPER_TRADING,
    timestamp: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRequest() {
  return {
    symbol: 'BTC/USDT',
    side: OrderSide.BUY,
    type: OrderType.MARKET,
    quantity: 0.1,
  };
}

function makeRetryableError(message = 'temporary failure') {
  return { isRetryable: true, message };
}

function makeNonRetryableError(message = 'order rejected') {
  return { isRetryable: false, message };
}

describe('RetryManagerService', () => {
  let service: RetryManagerService;

  beforeEach(() => {
    service = new RetryManagerService();
  });

  it('returns ok with order on first attempt when submission succeeds', async () => {
    const adapter = {
      submitOrder: jest.fn().mockResolvedValue({
        isOk: () => true,
        isErr: () => false,
        value: makeOrder(),
      }),
    };

    const result = await service.submit(adapter as any, makeRequest() as any, 3);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.attempts).toBe(1);
      expect(result.value.order.exchangeOrderId).toBe('ex-1');
    }
  });

  it('retries on retryable errors and succeeds on second attempt', async () => {
    const adapter = {
      submitOrder: jest
        .fn()
        .mockResolvedValueOnce({
          isOk: () => false,
          isErr: () => true,
          error: makeRetryableError(),
        })
        .mockResolvedValueOnce({ isOk: () => true, isErr: () => false, value: makeOrder() }),
    };

    const result = await service.submit(adapter as any, makeRequest() as any, 3);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.attempts).toBe(2);
    }
    expect(adapter.submitOrder).toHaveBeenCalledTimes(2);
  }, 10_000);

  it('does NOT retry on non-retryable errors', async () => {
    const adapter = {
      submitOrder: jest.fn().mockResolvedValue({
        isOk: () => false,
        isErr: () => true,
        error: makeNonRetryableError('order rejected'),
      }),
    };

    const result = await service.submit(adapter as any, makeRequest() as any, 3);
    expect(result.isErr()).toBe(true);
    expect(adapter.submitOrder).toHaveBeenCalledTimes(1);
  });

  it('returns ExecutionMaxRetriesError after exhausting all retries', async () => {
    const adapter = {
      submitOrder: jest.fn().mockResolvedValue({
        isOk: () => false,
        isErr: () => true,
        error: makeRetryableError('network timeout'),
      }),
    };

    const result = await service.submit(adapter as any, makeRequest() as any, 2);
    expect(result.isErr()).toBe(true);
    expect(adapter.submitOrder).toHaveBeenCalledTimes(3); // initial + 2 retries
    if (result.isErr()) {
      expect(result.error.message).toContain('3 attempts');
    }
  }, 10_000);

  it('returns SubmissionError on non-retryable failure', async () => {
    const adapter = {
      submitOrder: jest.fn().mockResolvedValue({
        isOk: () => false,
        isErr: () => true,
        error: makeNonRetryableError('insufficient balance'),
      }),
    };

    const result = await service.submit(adapter as any, makeRequest() as any, 3);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('insufficient balance');
    }
  });

  it('handles maxRetries=0 — submits exactly once without retry', async () => {
    const adapter = {
      submitOrder: jest.fn().mockResolvedValue({
        isOk: () => false,
        isErr: () => true,
        error: makeRetryableError(),
      }),
    };

    await service.submit(adapter as any, makeRequest() as any, 0);
    expect(adapter.submitOrder).toHaveBeenCalledTimes(1);
  });
});
