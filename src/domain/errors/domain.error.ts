import { HttpStatus } from '@nestjs/common';
import { BaseError, ErrorDetails } from '@common/errors/base.error';
import { ErrorCode } from '@common/errors/error-codes.enum';

/**
 * DomainError covers violations of business rules and domain invariants.
 *
 * These errors are NEVER retryable — retrying a business rule violation
 * will always produce the same outcome (failure). They always map to 4xx
 * HTTP responses because the client sent an invalid request.
 *
 * Domain errors deliberately carry no infrastructure knowledge. The HTTP
 * status mapping lives here at the class level, not in a filter lookup table.
 */
export abstract class DomainError extends BaseError {
  readonly isRetryable = false;
}

export class DomainValidationError extends DomainError {
  readonly code = ErrorCode.DOMAIN_VALIDATION_FAILED;
  readonly httpStatus = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(message: string, details?: ErrorDetails) {
    super(message, details);
  }
}

export class InvalidArgumentError extends DomainError {
  readonly code = ErrorCode.DOMAIN_INVALID_ARGUMENT;
  readonly httpStatus = HttpStatus.BAD_REQUEST;

  constructor(argumentName: string, reason: string, details?: ErrorDetails) {
    super(`Invalid argument "${argumentName}": ${reason}`, details);
  }
}

export class BusinessRuleViolationError extends DomainError {
  readonly code = ErrorCode.DOMAIN_BUSINESS_RULE_VIOLATED;
  readonly httpStatus = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(rule: string, details?: ErrorDetails) {
    super(`Business rule violated: ${rule}`, details);
  }
}

export class NotFoundError extends DomainError {
  readonly code = ErrorCode.DOMAIN_NOT_FOUND;
  readonly httpStatus = HttpStatus.NOT_FOUND;

  constructor(entityType: string, id: string | number, details?: ErrorDetails) {
    super(`${entityType} with id "${id}" was not found`, details);
  }
}

export class ConflictError extends DomainError {
  readonly code = ErrorCode.DOMAIN_CONFLICT;
  readonly httpStatus = HttpStatus.CONFLICT;

  constructor(message: string, details?: ErrorDetails) {
    super(message, details);
  }
}

export class UnauthorizedError extends DomainError {
  readonly code = ErrorCode.DOMAIN_UNAUTHORIZED;
  readonly httpStatus = HttpStatus.UNAUTHORIZED;

  constructor(details?: ErrorDetails) {
    super('Unauthorized access', details);
  }
}

export class ForbiddenError extends DomainError {
  readonly code = ErrorCode.DOMAIN_FORBIDDEN;
  readonly httpStatus = HttpStatus.FORBIDDEN;

  constructor(action: string, resource: string, details?: ErrorDetails) {
    super(`Forbidden: cannot perform "${action}" on "${resource}"`, details);
  }
}
