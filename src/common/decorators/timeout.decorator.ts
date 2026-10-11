import { withTimeout } from '@common/resilience/timeout.util';

/**
 * @Timeout(ms) enforces a maximum execution time on an async method.
 *
 * If the method does not complete within the specified duration,
 * InfrastructureTimeoutError is thrown. The underlying operation's Promise
 * is abandoned (Promises cannot be cancelled — use CancellationToken inside
 * the method body for cooperative cancellation).
 *
 * Usage:
 *   @Timeout(5000)
 *   async fetchQuote(symbol: string) { ... }
 */
export function Timeout(timeoutMs: number, operationName?: string): MethodDecorator {
  return (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor => {
    const originalMethod = descriptor.value as (...args: unknown[]) => Promise<unknown>;
    const name = operationName ?? `${target.constructor.name}.${String(propertyKey)}`;

    descriptor.value = async function (this: unknown, ...args: unknown[]): Promise<unknown> {
      return withTimeout(() => originalMethod.apply(this, args) as Promise<unknown>, timeoutMs, {
        operationName: name,
      });
    };

    return descriptor;
  };
}
