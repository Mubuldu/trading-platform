import { InfrastructureTimeoutError } from '@common/errors/infrastructure.error';
import { CancellationToken } from './cancellation-token';

/**
 * withTimeout races the provided async operation against a timer.
 *
 * If the timer fires first, the operation's Promise is abandoned (not
 * cancelled — Promises cannot be cancelled). The CancellationToken parameter
 * allows cooperative cancellation of the underlying operation's internal loop.
 *
 * The timeout handle is always cleared in the finally block to prevent
 * timer leaks that would keep the process alive after test completion.
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  options: {
    operationName?: string;
    cancellationToken?: CancellationToken;
  } = {},
): Promise<T> {
  const { operationName = 'operation', cancellationToken = CancellationToken.NONE } = options;

  cancellationToken.throwIfCancelled();

  let timeoutHandle!: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new InfrastructureTimeoutError(operationName, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}
