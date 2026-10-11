import { withRetry, RetryOptions } from '@common/resilience/retry.util';
import { BackoffStrategy, ExponentialBackoff } from '@common/resilience/backoff.strategy';

export type RetryDecoratorOptions = Omit<RetryOptions, 'operationName'> & {
  backoff?: BackoffStrategy;
};

/**
 * @Retry() automatically retries a method on failure.
 *
 * Uses the same withRetry() utility as manual retry logic — consistent
 * retry semantics regardless of whether retries are applied via decorator
 * or explicit code.
 *
 * The operation name in logs is derived from the class and method name.
 *
 * Only works on async methods. Applying to a sync method will wrap the
 * return value in a Promise, which is safe for all NestJS service methods.
 *
 * Usage:
 *   @Retry({ maxAttempts: 3, backoff: new ExponentialBackoff({ baseMs: 200 }) })
 *   async fetchMarketData(symbol: string) { ... }
 */
export function Retry(options: RetryDecoratorOptions): MethodDecorator {
  return (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor => {
    const originalMethod = descriptor.value as (...args: unknown[]) => Promise<unknown>;
    const operationName = `${target.constructor.name}.${String(propertyKey)}`;

    descriptor.value = async function (this: unknown, ...args: unknown[]): Promise<unknown> {
      return withRetry(() => originalMethod.apply(this, args) as Promise<unknown>, {
        ...options,
        backoff: options.backoff ?? new ExponentialBackoff(),
        operationName,
      });
    };

    return descriptor;
  };
}
