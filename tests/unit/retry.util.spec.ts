import { withRetry } from '@common/resilience/retry.util';
import { NoBackoff } from '@common/resilience/backoff.strategy';
import { CancellationToken } from '@common/resilience/cancellation-token';
import {
  MaxRetriesExceededError,
  OperationCancelledError,
} from '@common/errors/infrastructure.error';
import { DatabaseError } from '@common/errors/infrastructure.error';

describe('withRetry()', () => {
  it('returns result on first success', async () => {
    const result = await withRetry(() => Promise.resolve(42), {
      maxAttempts: 3,
      backoff: new NoBackoff(),
    });
    expect(result).toBe(42);
  });

  it('retries on retryable errors and succeeds', async () => {
    let attempt = 0;
    const result = await withRetry(
      async () => {
        attempt++;
        if (attempt < 3) throw new DatabaseError('transient');
        return 'success';
      },
      { maxAttempts: 5, backoff: new NoBackoff() },
    );
    expect(result).toBe('success');
    expect(attempt).toBe(3);
  });

  it('throws MaxRetriesExceededError after all attempts fail', async () => {
    await expect(
      withRetry(() => Promise.reject(new DatabaseError('permanent')), {
        maxAttempts: 3,
        backoff: new NoBackoff(),
        operationName: 'test-op',
      }),
    ).rejects.toBeInstanceOf(MaxRetriesExceededError);
  });

  it('does not retry when retryOn returns false', async () => {
    let attempt = 0;
    await expect(
      withRetry(
        async () => {
          attempt++;
          throw new Error('non-retryable');
        },
        {
          maxAttempts: 5,
          backoff: new NoBackoff(),
          retryOn: () => false,
        },
      ),
    ).rejects.toThrow('non-retryable');
    expect(attempt).toBe(1);
  });

  it('calls onRetry callback with attempt and delay info', async () => {
    const retryEvents: Array<{ attempt: number; delayMs: number }> = [];
    await expect(
      withRetry(() => Promise.reject(new DatabaseError('fail')), {
        maxAttempts: 3,
        backoff: new NoBackoff(),
        onRetry: (_err, attempt, delayMs) => retryEvents.push({ attempt, delayMs }),
      }),
    ).rejects.toBeInstanceOf(MaxRetriesExceededError);

    expect(retryEvents).toHaveLength(2);
    expect(retryEvents[0].attempt).toBe(1);
    expect(retryEvents[1].attempt).toBe(2);
  });

  it('stops retrying when cancellation token is cancelled', async () => {
    const token = new CancellationToken();
    let attempt = 0;
    setTimeout(() => token.cancel(), 10);

    await expect(
      withRetry(
        async () => {
          attempt++;
          throw new DatabaseError('fail');
        },
        {
          maxAttempts: 100,
          backoff: { getDelayMs: () => 20 },
          cancellationToken: token,
        },
      ),
    ).rejects.toBeInstanceOf(OperationCancelledError);

    expect(attempt).toBeLessThan(100);
  });
});
