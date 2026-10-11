import { HttpStatus } from '@nestjs/common';
import { ApplicationError } from '@common/errors/application.error';
import { InfrastructureError } from '@common/errors/infrastructure.error';
import { DomainError } from '@domain/errors/domain.error';
import { ErrorCode } from '@common/errors/error-codes.enum';
import { ErrorDetails } from '@common/errors/base.error';

/** Raised when an alert cannot be persisted or dispatched. */
export class AlertRaiseError extends ApplicationError {
  readonly code = ErrorCode.ALERT_RAISE_FAILED;
  readonly httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;

  constructor(reason: string, details?: ErrorDetails, cause?: Error) {
    super(`Alert raise failed: ${reason}`, details, cause);
  }
}

/**
 * Raised when a notification channel fails to deliver.
 * Extends InfrastructureError so it is retryable (network I/O failure).
 */
export class AlertDispatchError extends InfrastructureError {
  readonly code = ErrorCode.ALERT_DISPATCH_FAILED;
  readonly httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
  readonly isRetryable = true;

  constructor(channel: string, reason: string, details?: ErrorDetails, cause?: Error) {
    super(`Alert dispatch failed on channel "${channel}": ${reason}`, details, cause);
  }
}

/** Raised when an alert cannot be found for acknowledge / resolve. */
export class AlertNotFoundError extends DomainError {
  readonly code = ErrorCode.ALERT_NOT_FOUND;
  readonly httpStatus = HttpStatus.NOT_FOUND;

  constructor(id: string) {
    super(`Alert "${id}" not found`);
  }
}

/** Raised when trying to acknowledge or modify an already-resolved alert. */
export class AlertAlreadyResolvedError extends DomainError {
  readonly code = ErrorCode.ALERT_ALREADY_RESOLVED;
  readonly httpStatus = HttpStatus.CONFLICT;

  constructor(id: string) {
    super(`Alert "${id}" is already resolved`);
  }
}
