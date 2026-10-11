import { HttpStatus } from '@nestjs/common';
import { BaseError, ErrorDetails } from '@common/errors/base.error';
import { ErrorCode } from '@common/errors/error-codes.enum';

export abstract class OrderError extends BaseError {
  readonly isRetryable = false;
}

export class DuplicateOrderError extends OrderError {
  readonly code = ErrorCode.ORDER_DUPLICATE;
  readonly httpStatus = HttpStatus.CONFLICT;

  constructor(clientOrderId: string, details?: ErrorDetails) {
    super(`Duplicate order submission rejected: clientOrderId="${clientOrderId}"`, details);
  }
}

export class DuplicateReportError extends OrderError {
  readonly code = ErrorCode.ORDER_DUPLICATE_REPORT;
  readonly httpStatus = HttpStatus.CONFLICT;

  constructor(reportId: string, details?: ErrorDetails) {
    super(`Duplicate execution report rejected: reportId="${reportId}"`, details);
  }
}

export class ImpossibleOrderTransitionError extends OrderError {
  readonly code = ErrorCode.ORDER_IMPOSSIBLE_TRANSITION;
  readonly httpStatus = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(from: string, event: string, reason: string, details?: ErrorDetails) {
    super(`Impossible order transition: ${from} + event "${event}" — ${reason}`, details);
  }
}

export class OrderTimeoutError extends OrderError {
  readonly code = ErrorCode.ORDER_TIMEOUT;
  readonly httpStatus = HttpStatus.GATEWAY_TIMEOUT;

  constructor(orderId: string, state: string, details?: ErrorDetails) {
    super(`Order timed out in state "${state}": orderId="${orderId}"`, details);
  }
}

export class OrderNotFoundError extends OrderError {
  readonly code = ErrorCode.ORDER_NOT_FOUND;
  readonly httpStatus = HttpStatus.NOT_FOUND;

  constructor(identifier: string, details?: ErrorDetails) {
    super(`Order not found: "${identifier}"`, details);
  }
}

export class OrderPersistError extends OrderError {
  readonly code = ErrorCode.ORDER_PERSIST_FAILED;
  readonly httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;

  constructor(operation: string, cause?: Error) {
    super(`Order persistence failed during "${operation}"`, undefined, cause);
  }
}
