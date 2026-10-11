/**
 * ExportFormat controls the serialisation format for analytics data exports.
 *
 * CSV     — flat comma-separated values; one row per metric snapshot
 * JSON    — nested JSON; preserves full typed structure
 * PARQUET — columnar binary format (stub — reserved for future implementation)
 */
export enum ExportFormat {
  CSV = 'CSV',
  JSON = 'JSON',
  PARQUET = 'PARQUET',
}
