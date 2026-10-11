import { HttpStatus } from '@nestjs/common';
import { BaseError, ErrorDetails } from '@common/errors/base.error';
import { ErrorCode } from '@common/errors/error-codes.enum';

export abstract class ExecutionError extends BaseError {
  readonly isRetryable = false;

  protected constructor(message: string, details?: ErrorDetails, cause?: Error) {
    super(message, details, cause);
  }
}

export class ExecutionDisabledError extends ExecutionError {
  readonly code = ErrorCode.EXECUTION_DISABLED;
  readonly httpStatus = HttpStatus.SERVICE_UNAVAILABLE;

  constructor() {
    super('Execution Engine is disabled — no orders will be submitted');
  }
}

export class ExchangeNotConnectedError extends ExecutionError {
  readonly code = ErrorCode.EXECUTION_EXCHANGE_NOT_CONNECTED;
  readonly httpStatus = HttpStatus.SERVICE_UNAVAILABLE;

  constructor(exchangeId: string) {
    super(`Exchange "${exchangeId}" is not connected`);
  }
}

export class ExecutionValidationError extends ExecutionError {
  readonly code = ErrorCode.EXECUTION_VALIDATION_FAILED;
  readonly httpStatus = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(reason: string) {
    super(`Execution validation failed: ${reason}`);
  }
}

export class OrderBuildError extends ExecutionError {
  readonly code = ErrorCode.EXECUTION_ORDER_BUILD_FAILED;
  readonly httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;

  constructor(reason: string, cause?: Error) {
    super(`Failed to build order: ${reason}`, undefined, cause);
  }
}

export class RoutingError extends ExecutionError {
  readonly code = ErrorCode.EXECUTION_ROUTING_FAILED;
  readonly httpStatus = HttpStatus.BAD_GATEWAY;

  constructor(exchangeId: string, reason: string) {
    super(`Cannot route to exchange "${exchangeId}": ${reason}`);
  }
}

export class SubmissionError extends ExecutionError {
  readonly code = ErrorCode.EXECUTION_SUBMISSION_FAILED;
  readonly httpStatus = HttpStatus.BAD_GATEWAY;

  constructor(reason: string, cause?: Error) {
    super(`Order submission failed: ${reason}`, undefined, cause);
  }
}

export class ExecutionTimeoutError extends ExecutionError {
  readonly code = ErrorCode.EXECUTION_TIMEOUT;
  readonly httpStatus = HttpStatus.GATEWAY_TIMEOUT;

  constructor(timeoutMs: number) {
    super(`Order submission timed out after ${timeoutMs}ms`);
  }
}

export class ExecutionMaxRetriesError extends ExecutionError {
  readonly code = ErrorCode.EXECUTION_MAX_RETRIES_EXCEEDED;
  readonly httpStatus = HttpStatus.SERVICE_UNAVAILABLE;

  constructor(attempts: number, cause?: Error) {
    super(`Order submission failed after ${attempts} attempts`, undefined, cause);
  }
}

export class ExecutionRejectedError extends ExecutionError {
  readonly code = ErrorCode.EXECUTION_REJECTED;
  readonly httpStatus = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(exchangeId: string, reason: string) {
    super(`Order rejected by exchange "${exchangeId}": ${reason}`);
  }
}

export class CapabilityNotSupportedError extends ExecutionError {
  readonly code = ErrorCode.EXECUTION_CAPABILITY_NOT_SUPPORTED;
  readonly httpStatus = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(exchangeId: string, capability: string) {
    super(`Exchange "${exchangeId}" does not support capability: ${capability}`);
  }
}

export class DuplicateExecutionOrderError extends ExecutionError {
  readonly code = ErrorCode.EXECUTION_DUPLICATE_ORDER;
  readonly httpStatus = HttpStatus.CONFLICT;

  constructor(clientOrderId: string) {
    super(`Duplicate order detected for clientOrderId "${clientOrderId}"`);
  }
}
