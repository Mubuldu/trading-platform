/**
 * ReportPeriod defines the temporal granularity of a report.
 *
 * DAILY     — one calendar day (00:00–23:59 UTC)
 * WEEKLY    — Mon–Sun ISO week
 * MONTHLY   — calendar month
 * QUARTERLY — Q1–Q4 calendar quarters
 * YEARLY    — calendar year
 * CUSTOM    — arbitrary [from, to] date range
 */
export enum ReportPeriod {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  YEARLY = 'YEARLY',
  CUSTOM = 'CUSTOM',
}
