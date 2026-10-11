/**
 * Base class for all reporting module errors.
 */
export class ReportingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportingError';
  }
}

/**
 * Thrown when no analytics snapshots are found for the requested period.
 */
export class NoSnapshotDataError extends ReportingError {
  constructor(periodStart: string, periodEnd: string) {
    super(
      `No analytics snapshot data found for period ${periodStart} – ${periodEnd}. ` +
        'Run AnalyticsEngineService.compute() first.',
    );
    this.name = 'NoSnapshotDataError';
  }
}

/**
 * Thrown when a report config is invalid (e.g. CUSTOM period without date range).
 */
export class InvalidReportConfigError extends ReportingError {
  constructor(reason: string) {
    super(`Invalid report configuration: ${reason}`);
    this.name = 'InvalidReportConfigError';
  }
}

/**
 * Thrown when report storage fails in a context where the error must propagate
 * (e.g. an explicit archive call, not an auto-save).
 */
export class ReportStorageError extends ReportingError {
  constructor(operation: string, cause: Error) {
    super(`Report storage failure during "${operation}": ${cause.message}`);
    this.name = 'ReportStorageError';
    this.cause = cause;
  }
}

/**
 * Thrown when a report with the requested ID is not found in storage.
 */
export class ReportNotFoundError extends ReportingError {
  constructor(reportId: string) {
    super(`Report not found: ${reportId}`);
    this.name = 'ReportNotFoundError';
  }
}

/**
 * Thrown when strategy comparison is requested but snapshots for the given
 * strategy IDs cannot be found.
 */
export class StrategySnapshotNotFoundError extends ReportingError {
  constructor(strategyId: string) {
    super(`No analytics snapshot found for strategy: ${strategyId}`);
    this.name = 'StrategySnapshotNotFoundError';
  }
}
