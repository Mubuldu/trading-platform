import { HttpStatus } from '@nestjs/common';
import { BaseError, ErrorDetails } from '@common/errors/base.error';
import { ErrorCode } from '@common/errors/error-codes.enum';
import { ExchangeId } from '../enums/exchange.enums';
import { NormalizedSymbol } from '../models/common.model';

/**
 * ExchangeError is the root of all exchange-specific errors.
 *
 * Every exchange error carries the exchangeId so error handlers can
 * apply exchange-specific recovery strategies (e.g. Binance rate limit
 * has a different retry-after than Bybit).
 *
 * The `rawMessage` field holds the exchange's original error message
 * for diagnostics. It MUST NOT be forwarded to end users — it may
 * contain sensitive API response details.
 *
 * All exchange errors are non-retryable by default except where explicitly
 * overridden (e.g. RateLimitError, ConnectionError, TimeoutError).
 */
export abstract class ExchangeError extends BaseError {
  abstract readonly exchangeId: ExchangeId;
  readonly isRetryable: boolean = false;
  readonly rawMessage?: string;

  protected constructor(
    message: string,
    details?: ErrorDetails,
    cause?: Error,
    rawMessage?: string,
  ) {
    super(message, details, cause);
    this.rawMessage = rawMessage;
  }
}

export class AuthenticationError extends ExchangeError {
  readonly code = ErrorCode.EXCHANGE_AUTHENTICATION_FAILED;
  readonly httpStatus = HttpStatus.UNAUTHORIZED;

  constructor(
    readonly exchangeId: ExchangeId,
    details?: ErrorDetails,
    rawMessage?: string,
  ) {
    super(
      `Authentication failed for exchange "${exchangeId}" — verify API key and secret`,
      details,
      undefined,
      rawMessage,
    );
  }
}

export class RateLimitError extends ExchangeError {
  readonly code = ErrorCode.EXCHANGE_RATE_LIMIT_EXCEEDED;
  readonly httpStatus = HttpStatus.TOO_MANY_REQUESTS;
  readonly isRetryable = true;

  constructor(
    readonly exchangeId: ExchangeId,
    readonly retryAfterMs: number,
    details?: ErrorDetails,
    rawMessage?: string,
  ) {
    super(
      `Rate limit exceeded for exchange "${exchangeId}" — retry after ${retryAfterMs}ms`,
      { ...details, retryAfterMs },
      undefined,
      rawMessage,
    );
  }
}

export class InsufficientBalanceError extends ExchangeError {
  readonly code = ErrorCode.EXCHANGE_INSUFFICIENT_BALANCE;
  readonly httpStatus = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(
    readonly exchangeId: ExchangeId,
    readonly asset: string,
    readonly required: number,
    readonly available: number,
    rawMessage?: string,
  ) {
    super(
      `Insufficient ${asset} balance on "${exchangeId}": required ${required}, available ${available}`,
      { asset, required, available },
      undefined,
      rawMessage,
    );
  }
}

export class OrderRejectedError extends ExchangeError {
  readonly code = ErrorCode.EXCHANGE_ORDER_REJECTED;
  readonly httpStatus = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(
    readonly exchangeId: ExchangeId,
    readonly symbol: NormalizedSymbol,
    readonly reason: string,
    details?: ErrorDetails,
    rawMessage?: string,
  ) {
    super(
      `Order rejected by "${exchangeId}" for "${symbol}": ${reason}`,
      details,
      undefined,
      rawMessage,
    );
  }
}

export class ExchangeMaintenanceError extends ExchangeError {
  readonly code = ErrorCode.EXCHANGE_MAINTENANCE;
  readonly httpStatus = HttpStatus.SERVICE_UNAVAILABLE;

  constructor(
    readonly exchangeId: ExchangeId,
    readonly estimatedRestoreAt?: Date,
    rawMessage?: string,
  ) {
    super(
      `Exchange "${exchangeId}" is currently under maintenance`,
      estimatedRestoreAt ? { estimatedRestoreAt: estimatedRestoreAt.toISOString() } : undefined,
      undefined,
      rawMessage,
    );
  }
}

export class UnknownSymbolError extends ExchangeError {
  readonly code = ErrorCode.EXCHANGE_UNKNOWN_SYMBOL;
  readonly httpStatus = HttpStatus.BAD_REQUEST;

  constructor(
    readonly exchangeId: ExchangeId,
    readonly symbol: NormalizedSymbol,
    rawMessage?: string,
  ) {
    super(
      `Symbol "${symbol}" is not recognized on exchange "${exchangeId}"`,
      { symbol },
      undefined,
      rawMessage,
    );
  }
}

export class ExchangeNetworkFailureError extends ExchangeError {
  readonly code = ErrorCode.EXCHANGE_NETWORK_FAILURE;
  readonly httpStatus = HttpStatus.BAD_GATEWAY;
  readonly isRetryable = true;

  constructor(
    readonly exchangeId: ExchangeId,
    cause?: Error,
    rawMessage?: string,
  ) {
    super(
      `Network failure communicating with exchange "${exchangeId}"`,
      undefined,
      cause,
      rawMessage,
    );
  }
}

export class ExchangeConnectionError extends ExchangeError {
  readonly code = ErrorCode.EXCHANGE_CONNECTION_ERROR;
  readonly httpStatus = HttpStatus.BAD_GATEWAY;
  readonly isRetryable = true;

  constructor(
    readonly exchangeId: ExchangeId,
    cause?: Error,
    rawMessage?: string,
  ) {
    super(
      `Connection to exchange "${exchangeId}" failed or was closed`,
      undefined,
      cause,
      rawMessage,
    );
  }
}

export class ExchangeTimeoutError extends ExchangeError {
  readonly code = ErrorCode.EXCHANGE_TIMEOUT;
  readonly httpStatus = HttpStatus.GATEWAY_TIMEOUT;
  readonly isRetryable = true;

  constructor(
    readonly exchangeId: ExchangeId,
    readonly operationName: string,
    readonly timeoutMs: number,
    rawMessage?: string,
  ) {
    super(
      `Exchange "${exchangeId}" did not respond to "${operationName}" within ${timeoutMs}ms`,
      { operationName, timeoutMs },
      undefined,
      rawMessage,
    );
  }
}

export class ExchangeInvalidRequestError extends ExchangeError {
  readonly code = ErrorCode.EXCHANGE_INVALID_REQUEST;
  readonly httpStatus = HttpStatus.BAD_REQUEST;

  constructor(
    readonly exchangeId: ExchangeId,
    readonly reason: string,
    details?: ErrorDetails,
    rawMessage?: string,
  ) {
    super(`Invalid request to exchange "${exchangeId}": ${reason}`, details, undefined, rawMessage);
  }
}

export class ExchangePermissionDeniedError extends ExchangeError {
  readonly code = ErrorCode.EXCHANGE_PERMISSION_DENIED;
  readonly httpStatus = HttpStatus.FORBIDDEN;

  constructor(
    readonly exchangeId: ExchangeId,
    readonly requiredPermission: string,
    rawMessage?: string,
  ) {
    super(
      `API key on "${exchangeId}" lacks required permission: ${requiredPermission}`,
      { requiredPermission },
      undefined,
      rawMessage,
    );
  }
}

export class ExchangeDuplicateOrderError extends ExchangeError {
  readonly code = ErrorCode.EXCHANGE_DUPLICATE_ORDER;
  readonly httpStatus = HttpStatus.CONFLICT;

  constructor(
    readonly exchangeId: ExchangeId,
    readonly clientOrderId: string,
    rawMessage?: string,
  ) {
    super(
      `Duplicate order detected on "${exchangeId}" for clientOrderId "${clientOrderId}"`,
      { clientOrderId },
      undefined,
      rawMessage,
    );
  }
}

export class ExchangeUnsupportedOperationError extends ExchangeError {
  readonly code = ErrorCode.EXCHANGE_UNSUPPORTED_OPERATION;
  readonly httpStatus = HttpStatus.METHOD_NOT_ALLOWED;

  constructor(
    readonly exchangeId: ExchangeId,
    readonly operation: string,
    rawMessage?: string,
  ) {
    super(
      `Exchange "${exchangeId}" does not support operation: ${operation}`,
      { operation },
      undefined,
      rawMessage,
    );
  }
}
