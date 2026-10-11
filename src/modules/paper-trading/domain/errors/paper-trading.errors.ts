import { HttpStatus } from '@nestjs/common';
import { BaseError } from '@common/errors/base.error';
import { ErrorCode } from '@common/errors/error-codes.enum';

export class PaperInsufficientBalanceError extends BaseError {
  readonly code = ErrorCode.EXCHANGE_INSUFFICIENT_BALANCE;
  readonly httpStatus = HttpStatus.UNPROCESSABLE_ENTITY;
  readonly isRetryable = false;

  constructor(required: number, available: number) {
    super(
      `Paper account has insufficient balance: required ${required.toFixed(2)} USDT, available ${available.toFixed(2)} USDT`,
      { required, available },
    );
  }
}

export class PaperOrderNotFoundError extends BaseError {
  readonly code = ErrorCode.EXCHANGE_INVALID_REQUEST;
  readonly httpStatus = HttpStatus.NOT_FOUND;
  readonly isRetryable = false;

  constructor(orderId: string) {
    super(`Paper order not found: ${orderId}`, { orderId });
  }
}

export class PaperTradingDisabledError extends BaseError {
  readonly code = ErrorCode.EXCHANGE_INVALID_REQUEST;
  readonly httpStatus = HttpStatus.SERVICE_UNAVAILABLE;
  readonly isRetryable = false;

  constructor() {
    super('Paper trading is disabled — set PAPER_TRADING_ENABLED=true to enable');
  }
}

export class PaperUnsupportedOperationError extends BaseError {
  readonly code = ErrorCode.EXCHANGE_UNSUPPORTED_OPERATION;
  readonly httpStatus = HttpStatus.METHOD_NOT_ALLOWED;
  readonly isRetryable = false;

  constructor(operation: string) {
    super(`Paper trading adapter does not support operation: ${operation}`, { operation });
  }
}
