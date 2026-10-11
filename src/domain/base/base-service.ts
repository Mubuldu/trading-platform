import { ILogger } from '@core/logging/logger.interface';
import { BaseError } from '@common/errors/base.error';
import { Result, err } from '@common/result';
import { fromPromise } from '@common/result/result';

/**
 * BaseService provides common infrastructure for NestJS application services.
 *
 * Subclass this in application-layer services (use cases) that orchestrate
 * domain objects. Do NOT subclass in pure domain services — those have no
 * dependency on infrastructure.
 *
 * Provides:
 *  - Structured logging with automatic context naming
 *  - executeWithResult: wraps a Promise in a Result, mapping errors
 *  - logAndReturn: logs an error Result before returning it
 */
export abstract class BaseService {
  protected constructor(protected readonly logger: ILogger) {}

  protected get context(): string {
    return this.constructor.name;
  }

  protected async executeWithResult<T>(
    operationName: string,
    fn: () => Promise<T>,
    mapError: (error: unknown) => BaseError,
  ): Promise<Result<T>> {
    const result = await fromPromise(fn(), mapError);
    if (result.isErr()) {
      this.logger.error(
        `[${operationName}] failed: ${result.error.message}`,
        result.error.stack,
        this.context,
      );
    }
    return result;
  }

  protected logError(error: BaseError, operation?: string): void {
    const label = operation ? `[${operation}] ` : '';
    this.logger.error(`${label}${error.message}`, error.stack, this.context);
  }

  protected logAndReturn<T, E extends BaseError>(
    result: Result<T, E>,
    operation?: string,
  ): Result<T, E> {
    if (result.isErr()) {
      this.logError(result.error, operation);
    }
    return result;
  }

  protected wrapError<T>(error: unknown, mapFn: (e: unknown) => BaseError): Result<T> {
    return err(mapFn(error));
  }
}
