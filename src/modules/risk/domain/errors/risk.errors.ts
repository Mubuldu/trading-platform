import { HttpStatus } from '@nestjs/common';
import { BaseError, ErrorDetails } from '@common/errors/base.error';
import { ErrorCode } from '@common/errors/error-codes.enum';
import { DomainError } from '@domain/errors/domain.error';

export class RiskSignalRejectedError extends DomainError {
  readonly code = ErrorCode.RISK_SIGNAL_REJECTED;
  readonly httpStatus = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(signalId: string, reason: string, details?: ErrorDetails) {
    super(`Signal "${signalId}" rejected: ${reason}`, details);
  }
}

export class RiskSignalBlockedError extends DomainError {
  readonly code = ErrorCode.RISK_SIGNAL_BLOCKED;
  readonly httpStatus = HttpStatus.FORBIDDEN;

  constructor(signalId: string, reason: string, details?: ErrorDetails) {
    super(`Signal "${signalId}" blocked: ${reason}`, details);
  }
}

export class RiskEngineInternalError extends BaseError {
  readonly code = ErrorCode.RISK_ENGINE_ERROR;
  readonly httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
  readonly isRetryable = false;

  constructor(message: string, details?: ErrorDetails) {
    super(message, details);
  }
}
