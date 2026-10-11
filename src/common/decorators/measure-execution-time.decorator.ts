import { ILogger } from '@core/logging/logger.interface';

const LOGGER_PROP = 'logger';

/**
 * @MeasureExecutionTime() records the wall-clock duration of a method call
 * and emits it as a log entry.
 *
 * The decorator reads the logger from the class instance property named
 * "logger". This convention is consistent with BaseService. If no logger is
 * found on the instance, the measurement is silently skipped — the method
 * still executes normally.
 *
 * Works with both sync and async methods.
 * Does NOT suppress errors — any thrown exception propagates unchanged.
 *
 * Usage:
 *   @MeasureExecutionTime()
 *   async placeOrder(dto: PlaceOrderDto) { ... }
 */
export function MeasureExecutionTime(label?: string): MethodDecorator {
  return (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor => {
    const originalMethod = descriptor.value as (...args: unknown[]) => unknown;
    const methodName = label ?? String(propertyKey);

    descriptor.value = async function (
      this: Record<string, unknown>,
      ...args: unknown[]
    ): Promise<unknown> {
      const start = process.hrtime.bigint();
      try {
        return await originalMethod.apply(this, args);
      } finally {
        const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
        const logger = this[LOGGER_PROP] as ILogger | undefined;
        if (logger && typeof logger.debug === 'function') {
          logger.debug(
            `${methodName} completed in ${durationMs.toFixed(2)}ms`,
            target.constructor.name,
            { durationMs, method: methodName },
          );
        }
      }
    };

    return descriptor;
  };
}
