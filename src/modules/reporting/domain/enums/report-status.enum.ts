/**
 * ReportStatus tracks the lifecycle state of a report record.
 *
 * PENDING    — queued, not yet started
 * GENERATING — in progress
 * COMPLETE   — generation succeeded; all sections populated
 * FAILED     — generation failed; error recorded in the report metadata
 */
export enum ReportStatus {
  PENDING = 'PENDING',
  GENERATING = 'GENERATING',
  COMPLETE = 'COMPLETE',
  FAILED = 'FAILED',
}
