import { HttpStatus } from '@nestjs/common';
import { BaseError, ErrorDetails } from './base.error';
import { ErrorCode } from './error-codes.enum';

/**
 * ApplicationError covers failures within the application layer itself:
 * bad configuration, failed initialization, unsupported operations.
 *
 * These are NOT domain rule violations and NOT infrastructure failures.
 * They indicate a programming or deployment error and are never retryable.
 */
export abstract class ApplicationError extends BaseError {
  readonly httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
  readonly isRetryable = false;
}

export class ConfigurationError extends ApplicationError {
  readonly code = ErrorCode.APP_CONFIG_INVALID;

  constructor(message: string, details?: ErrorDetails) {
    super(message, details);
  }
}

export class InitializationError extends ApplicationError {
  readonly code = ErrorCode.APP_INITIALIZATION_FAILED;

  constructor(message: string, details?: ErrorDetails, cause?: Error) {
    super(message, details, cause);
  }
}

export class UnsupportedOperationError extends ApplicationError {
  readonly code = ErrorCode.APP_UNSUPPORTED_OPERATION;

  constructor(operation: string, details?: ErrorDetails) {
    super(`Operation not supported: ${operation}`, details);
  }
}
