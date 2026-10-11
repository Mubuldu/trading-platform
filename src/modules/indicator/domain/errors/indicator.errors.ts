import { HttpStatus } from '@nestjs/common';
import { DomainError } from '@domain/errors/domain.error';
import { ErrorCode } from '@common/errors/error-codes.enum';

export class IndicatorInvalidCandleError extends DomainError {
  readonly code = ErrorCode.INDICATOR_INVALID_CANDLE;
  readonly httpStatus = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(reason: string, details?: Record<string, unknown>) {
    super(`Invalid candle: ${reason}`, details);
  }
}

export class IndicatorNotWarmedUpError extends DomainError {
  readonly code = ErrorCode.INDICATOR_NOT_WARMED_UP;
  readonly httpStatus = HttpStatus.CONFLICT;

  constructor(indicatorId: string, warmupRequired: number, candlesProcessed: number) {
    super(
      `Indicator "${indicatorId}" not warmed up: needs ${warmupRequired} candles, has ${candlesProcessed}`,
      { indicatorId, warmupRequired, candlesProcessed },
    );
  }
}

export class IndicatorNotFoundError extends DomainError {
  readonly code = ErrorCode.INDICATOR_NOT_FOUND;
  readonly httpStatus = HttpStatus.NOT_FOUND;

  constructor(indicatorId: string) {
    super(`Indicator "${indicatorId}" not found`, { indicatorId });
  }
}

export class IndicatorAlreadyRegisteredError extends DomainError {
  readonly code = ErrorCode.INDICATOR_ALREADY_REGISTERED;
  readonly httpStatus = HttpStatus.CONFLICT;

  constructor(indicatorId: string) {
    super(`Indicator "${indicatorId}" is already registered`, { indicatorId });
  }
}

export class IndicatorCalculationFailedError extends DomainError {
  readonly code = ErrorCode.INDICATOR_CALCULATION_FAILED;
  readonly httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;

  constructor(indicatorId: string, reason: string) {
    super(`Indicator "${indicatorId}" calculation failed: ${reason}`, { indicatorId, reason });
  }
}

export class IndicatorPublishFailedError extends DomainError {
  readonly code = ErrorCode.INDICATOR_PUBLISH_FAILED;
  readonly httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;

  constructor(indicatorId: string, reason: string) {
    super(`Indicator "${indicatorId}" publish failed: ${reason}`, { indicatorId, reason });
  }
}

export class IndicatorWarmupFailedError extends DomainError {
  readonly code = ErrorCode.INDICATOR_WARMUP_FAILED;
  readonly httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;

  constructor(indicatorId: string, reason: string) {
    super(`Indicator "${indicatorId}" warmup failed: ${reason}`, { indicatorId, reason });
  }
}

export type IndicatorError =
  | IndicatorInvalidCandleError
  | IndicatorNotWarmedUpError
  | IndicatorNotFoundError
  | IndicatorAlreadyRegisteredError
  | IndicatorCalculationFailedError
  | IndicatorPublishFailedError
  | IndicatorWarmupFailedError;
