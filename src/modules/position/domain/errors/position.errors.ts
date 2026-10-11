import { HttpStatus } from '@nestjs/common';
import { BaseError, ErrorDetails } from '@common/errors/base.error';
import { ErrorCode } from '@common/errors/error-codes.enum';

export abstract class PositionError extends BaseError {
  readonly isRetryable = false;
}

export class InvalidPositionStateError extends PositionError {
  readonly code = ErrorCode.POSITION_INVALID_STATE;
  readonly httpStatus = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(current: string, attempted: string, details?: ErrorDetails) {
    super(
      `Invalid position state: cannot transition from "${current}" with action "${attempted}"`,
      details,
    );
  }
}

export class DuplicateFillError extends PositionError {
  readonly code = ErrorCode.POSITION_DUPLICATE_FILL;
  readonly httpStatus = HttpStatus.CONFLICT;

  constructor(fillId: string, details?: ErrorDetails) {
    super(`Duplicate fill rejected: fillId="${fillId}" already applied`, details);
  }
}

export class NegativeQuantityError extends PositionError {
  readonly code = ErrorCode.POSITION_NEGATIVE_QUANTITY;
  readonly httpStatus = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(quantity: number, details?: ErrorDetails) {
    super(`Negative quantity rejected: quantity=${quantity}`, details);
  }
}

export class InvalidAveragePriceError extends PositionError {
  readonly code = ErrorCode.POSITION_INVALID_PRICE;
  readonly httpStatus = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(price: number, details?: ErrorDetails) {
    super(`Invalid average price: price=${price}`, details);
  }
}

export class ImpossibleStateTransitionError extends PositionError {
  readonly code = ErrorCode.POSITION_IMPOSSIBLE_TRANSITION;
  readonly httpStatus = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(from: string, to: string, reason: string, details?: ErrorDetails) {
    super(`Impossible state transition: ${from} → ${to} — ${reason}`, details);
  }
}

export class PositionPersistError extends PositionError {
  readonly code = ErrorCode.POSITION_PERSIST_FAILED;
  readonly httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;

  constructor(operation: string, cause?: Error) {
    super(`Position persistence failed during "${operation}"`, undefined, cause);
  }
}
