/**
 * ReportExportFormat defines the serialisation target for a report.
 *
 * JSON     — structured JSON; suitable for API consumers and archival
 * CSV      — tabular CSV; one file per section
 * MARKDOWN — human-readable Markdown with tables
 *
 * Future:
 *   PDF  — rendered via headless browser (not yet implemented)
 *   HTML — standalone self-contained page (not yet implemented)
 */
export enum ReportExportFormat {
  JSON = 'JSON',
  CSV = 'CSV',
  MARKDOWN = 'MARKDOWN',
}
