import { HttpStatus } from '@nestjs/common';
import { BaseError, ErrorDetails } from './base.error';
import { ErrorCode } from './error-codes.enum';

/**
 * InfrastructureError covers failures in external systems: databases, network,
 * message queues, and third-party APIs. Most infrastructure errors are
 * retryable because the external system may recover.
 *
 * The global exception filter maps these to 5xx responses. Load balancers
 * watching for 5xx can use this to route traffic away from unhealthy instances.
 */
export abstract class InfrastructureError extends BaseError {}

export class DatabaseError extends InfrastructureError {
  readonly code = ErrorCode.INFRA_DATABASE_ERROR;
  readonly httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
  readonly isRetryable = true;

  constructor(message: string, details?: ErrorDetails, cause?: Error) {
    super(message, details, cause);
  }
}

export class NetworkError extends InfrastructureError {
  readonly code = ErrorCode.INFRA_NETWORK_ERROR;
  readonly httpStatus = HttpStatus.BAD_GATEWAY;
  readonly isRetryable = true;

  constructor(message: string, details?: ErrorDetails, cause?: Error) {
    super(message, details, cause);
  }
}

export class InfrastructureTimeoutError extends InfrastructureError {
  readonly code = ErrorCode.INFRA_TIMEOUT;
  readonly httpStatus = HttpStatus.GATEWAY_TIMEOUT;
  readonly isRetryable = true;
  readonly operationName: string;
  readonly timeoutMs: number;

  constructor(operationName: string, timeoutMs: number, details?: ErrorDetails) {
    super(`Operation "${operationName}" timed out after ${timeoutMs}ms`, details);
    this.operationName = operationName;
    this.timeoutMs = timeoutMs;
  }
}

export class ServiceUnavailableError extends InfrastructureError {
  readonly code = ErrorCode.INFRA_UNAVAILABLE;
  readonly httpStatus = HttpStatus.SERVICE_UNAVAILABLE;
  readonly isRetryable = true;

  constructor(serviceName: string, details?: ErrorDetails, cause?: Error) {
    super(`Service "${serviceName}" is unavailable`, details, cause);
  }
}

export class CircuitBreakerOpenError extends InfrastructureError {
  readonly code = ErrorCode.CIRCUIT_BREAKER_OPEN;
  readonly httpStatus = HttpStatus.SERVICE_UNAVAILABLE;
  readonly isRetryable = false;

  constructor(circuitName: string, details?: ErrorDetails) {
    super(`Circuit breaker "${circuitName}" is open — requests are being rejected`, details);
  }
}

export class MaxRetriesExceededError extends InfrastructureError {
  readonly code = ErrorCode.MAX_RETRIES_EXCEEDED;
  readonly httpStatus = HttpStatus.SERVICE_UNAVAILABLE;
  readonly isRetryable = false;

  constructor(operation: string, maxAttempts: number, cause?: Error) {
    super(`Operation "${operation}" failed after ${maxAttempts} attempts`, undefined, cause);
  }
}

export class OperationCancelledError extends InfrastructureError {
  readonly code = ErrorCode.OPERATION_CANCELLED;
  readonly httpStatus = HttpStatus.CONFLICT;
  readonly isRetryable = false;

  constructor(details?: ErrorDetails) {
    super('Operation was cancelled', details);
  }
}

export class SerializationError extends InfrastructureError {
  readonly code = ErrorCode.INFRA_SERIALIZATION_ERROR;
  readonly httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
  readonly isRetryable = false;

  constructor(message: string, details?: ErrorDetails, cause?: Error) {
    super(message, details, cause);
  }
}
