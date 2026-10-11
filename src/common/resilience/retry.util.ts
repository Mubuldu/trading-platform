import { MaxRetriesExceededError } from '@common/errors/infrastructure.error';
import { BackoffStrategy, ExponentialBackoff } from './backoff.strategy';
import { CancellationToken } from './cancellation-token';

export interface RetryOptions {
  maxAttempts: number;
  backoff?: BackoffStrategy;
  retryOn?: (error: unknown) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  cancellationToken?: CancellationToken;
  operationName?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultRetryOn(error: unknown): boolean {
  if (error instanceof Error && 'isRetryable' in error) {
    return (error as { isRetryable: boolean }).isRetryable === true;
  }
  return false;
}

/**
 * withRetry executes an async operation with automatic retry on failure.
 *
 * The operation function receives the current attempt number (1-indexed) so
 * callers can implement attempt-specific logic (e.g. different endpoints).
 *
 * Retry is attempted when retryOn(error) returns true. By default this checks
 * BaseError.isRetryable. Override retryOn to handle third-party errors that
 * don't extend BaseError.
 *
 * The backoff delay is computed per-attempt. With exponential jitter, each
 * retry fires at a random point within the computed window, spreading load
 * across the fleet.
 *
 * If all attempts fail, MaxRetriesExceededError is thrown wrapping the last
 * underlying error. This preserves the error chain for diagnostics.
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const {
    maxAttempts,
    backoff = new ExponentialBackoff(),
    retryOn = defaultRetryOn,
    onRetry,
    cancellationToken = CancellationToken.NONE,
    operationName = 'operation',
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    cancellationToken.throwIfCancelled();

    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts) break;

      if (!retryOn(error)) {
        throw error;
      }

      const delayMs = backoff.getDelayMs(attempt);
      onRetry?.(error, attempt, delayMs);

      if (delayMs > 0) {
        await sleep(delayMs);
      }

      cancellationToken.throwIfCancelled();
    }
  }

  throw new MaxRetriesExceededError(
    operationName,
    maxAttempts,
    lastError instanceof Error ? lastError : undefined,
  );
}
