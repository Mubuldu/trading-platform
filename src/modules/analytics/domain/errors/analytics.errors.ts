import { ApplicationError } from '@common/errors/application.error';
import { ErrorCode } from '@common/errors/error-codes.enum';

/**
 * Abstract base for all analytics module failures.
 * Subtypes narrow the failure mode for monitoring and alerting.
 *
 * Each concrete subclass must declare:
 *   readonly code = ErrorCode.ANALYTICS_*;
 */
export abstract class AnalyticsError extends ApplicationError {}

/** Raised when there is insufficient data to compute a metric. */
export class AnalyticsInsufficientDataError extends AnalyticsError {
  override readonly code = ErrorCode.ANALYTICS_INSUFFICIENT_DATA;

  constructor(requiredPoints: number, available: number, metric: string) {
    super(`Cannot compute ${metric}: need ≥${requiredPoints} data points, have ${available}`);
    this.name = 'AnalyticsInsufficientDataError';
  }
}

/** Raised when the analytics engine fails to collect data from upstream sources. */
export class AnalyticsDataCollectionError extends AnalyticsError {
  override readonly code = ErrorCode.ANALYTICS_DATA_COLLECTION_FAILED;

  constructor(source: string, cause?: Error) {
    super(`Analytics data collection failed for source: ${source}`, undefined, cause);
    this.name = 'AnalyticsDataCollectionError';
  }
}

/** Raised when a metric computation encounters an invalid input (e.g. negative capital). */
export class AnalyticsCalculationError extends AnalyticsError {
  override readonly code = ErrorCode.ANALYTICS_CALCULATION_FAILED;

  constructor(calculator: string, reason: string, cause?: Error) {
    super(`Analytics calculation error in ${calculator}: ${reason}`, undefined, cause);
    this.name = 'AnalyticsCalculationError';
  }
}

/** Raised when an analytics snapshot cannot be persisted. */
export class AnalyticsStorageError extends AnalyticsError {
  override readonly code = ErrorCode.ANALYTICS_STORAGE_FAILED;

  constructor(operation: string, cause?: Error) {
    super(`Analytics storage operation failed: ${operation}`, undefined, cause);
    this.name = 'AnalyticsStorageError';
  }
}

/** Raised when an export operation fails. */
export class AnalyticsExportError extends AnalyticsError {
  override readonly code = ErrorCode.ANALYTICS_EXPORT_FAILED;

  constructor(format: string, cause?: Error) {
    super(`Analytics export failed for format: ${format}`, undefined, cause);
    this.name = 'AnalyticsExportError';
  }
}
