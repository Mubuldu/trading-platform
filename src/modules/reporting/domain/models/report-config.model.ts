import { ReportPeriod } from '../enums/report-period.enum';
import { ReportSource } from '../enums/report-source.enum';
import { ReportExportFormat } from '../enums/report-export-format.enum';

/**
 * ReportConfig is the input contract for generating a report.
 *
 * Either (period + reference date) or (fromMs + toMs) must be supplied.
 * When period is CUSTOM, fromMs and toMs are required.
 *
 * strategyIds — when empty, the report is portfolio-level (all strategies).
 *               When populated, per-strategy sections are included and
 *               strategyComparison is populated when more than one ID is given.
 */
export interface ReportConfig {
  readonly period: ReportPeriod;
  readonly source: ReportSource;
  readonly sessionId: string;

  /** Strategies to include. Empty = portfolio-level (all strategies). */
  readonly strategyIds: string[];

  /**
   * Reference date for period resolution (ISO date string YYYY-MM-DD).
   * Ignored when period is CUSTOM.
   * Defaults to "today" when absent.
   */
  readonly referenceDate?: string;

  /** Unix ms — required when period is CUSTOM. */
  readonly fromMs?: number;

  /** Unix ms — required when period is CUSTOM. */
  readonly toMs?: number;

  /** Output formats to generate. Defaults to [JSON] when absent. */
  readonly formats: ReportExportFormat[];

  /**
   * Title override. Defaults to an auto-generated title based on period/source.
   */
  readonly titleOverride?: string;
}
