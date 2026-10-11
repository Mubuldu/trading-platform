import { ErrorCode } from './error-codes.enum';

export type ErrorDetails = Record<string, unknown>;

/**
 * BaseError is the root of every error in the platform.
 *
 * All errors carry:
 *  - code          — stable machine-readable identifier (never changes between releases)
 *  - httpStatus    — the HTTP status code this error maps to
 *  - isRetryable   — whether the caller should retry the operation
 *  - details       — optional structured context for debugging (NEVER sent to end users)
 *  - timestamp     — when the error was created
 *  - cause         — the underlying error that triggered this one (for error chaining)
 *
 * The GlobalExceptionFilter reads `httpStatus` and `code` to build the HTTP
 * response, so every concrete error class controls its own HTTP mapping.
 *
 * Extension: create a new concrete class that extends the appropriate abstract
 * layer (ApplicationError, DomainError, InfrastructureError). Never extend
 * BaseError directly.
 */
export abstract class BaseError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly httpStatus: number;
  abstract readonly isRetryable: boolean;

  readonly details?: ErrorDetails;
  readonly timestamp: Date;

  protected constructor(message: string, details?: ErrorDetails, cause?: Error) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
    this.timestamp = new Date();
    if (cause !== undefined) {
      this.cause = cause;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      httpStatus: this.httpStatus,
      isRetryable: this.isRetryable,
      details: this.details,
      timestamp: this.timestamp.toISOString(),
    };
  }
}
