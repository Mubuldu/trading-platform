import { ReportPeriod } from '../enums/report-period.enum';
import { ReportSource } from '../enums/report-source.enum';
import { ReportStatus } from '../enums/report-status.enum';
import { ReportExportFormat } from '../enums/report-export-format.enum';
import { ExecutiveSummarySection } from './sections/executive-summary.section';
import { PortfolioPerformanceSection } from './sections/portfolio-performance.section';
import { TradeSummarySection } from './sections/trade-summary.section';
import { RiskMetricsSection } from './sections/risk-metrics.section';
import { DrawdownAnalysisSection } from './sections/drawdown-analysis.section';
import { StrategyComparisonSection } from './sections/strategy-comparison.section';
import { ExecutionQualitySection } from './sections/execution-quality.section';
import { ExposureAnalysisSection } from './sections/exposure-analysis.section';
import { RecommendationsSection } from './sections/recommendations.section';
import { ReportCharts } from './charts/report-charts.model';

/**
 * TradingReport is the complete, versioned output of the report generator.
 *
 * Immutability: once generated, a report is never mutated.
 * Re-generation produces a new report with the same reportId but an
 * incremented version number.
 *
 * All monetary values are in quote currency (USDT).
 * All percentage values are fractional unless the field name ends in Percent
 * (those are already ×100).
 */
export interface TradingReport {
  // ── Identity ──────────────────────────────────────────────────────────────
  readonly reportId: string; // UUID — stable across re-generations
  readonly version: number; // starts at 1, increments on re-generation
  readonly generatedAt: number; // unix ms

  // ── Classification ────────────────────────────────────────────────────────
  readonly title: string; // e.g. "Daily Report — 2024-01-15"
  readonly period: ReportPeriod;
  readonly source: ReportSource;
  readonly sessionId: string;
  readonly strategyIds: string[]; // [] = portfolio-level

  // ── Date range ────────────────────────────────────────────────────────────
  readonly periodStartDate: string; // YYYY-MM-DD
  readonly periodEndDate: string; // YYYY-MM-DD
  readonly periodStartMs: number; // unix ms
  readonly periodEndMs: number; // unix ms

  // ── Data provenance ───────────────────────────────────────────────────────
  /** IDs of the AnalyticsSnapshots used to build this report. */
  readonly snapshotIds: string[];

  // ── Sections ──────────────────────────────────────────────────────────────
  readonly executiveSummary: ExecutiveSummarySection;
  readonly portfolioPerformance: PortfolioPerformanceSection;
  readonly tradeSummary: TradeSummarySection;
  readonly riskMetrics: RiskMetricsSection;
  readonly drawdownAnalysis: DrawdownAnalysisSection;

  /**
   * Populated only when the config specifies more than one strategyId.
   * null for single-strategy and portfolio-level reports.
   */
  readonly strategyComparison: StrategyComparisonSection | null;

  readonly executionQuality: ExecutionQualitySection;
  readonly exposureAnalysis: ExposureAnalysisSection;
  readonly recommendations: RecommendationsSection;

  // ── Chart data ────────────────────────────────────────────────────────────
  readonly charts: ReportCharts;

  // ── Export formats ────────────────────────────────────────────────────────
  readonly formats: ReportExportFormat[];

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  readonly status: ReportStatus;
  readonly generationDurationMs: number;
  readonly errorMessage?: string; // set when status === FAILED
}

/**
 * ReportSummary — lightweight descriptor stored in the report index.
 * Enough to list/filter reports without loading the full payload.
 */
export interface ReportSummary {
  readonly reportId: string;
  readonly version: number;
  readonly generatedAt: number;
  readonly title: string;
  readonly period: ReportPeriod;
  readonly source: ReportSource;
  readonly sessionId: string;
  readonly strategyIds: string[];
  readonly periodStartDate: string;
  readonly periodEndDate: string;
  readonly status: ReportStatus;

  // Key metrics for quick display
  readonly netProfit: number;
  readonly totalReturnPercent: number;
  readonly sharpeRatio: number;
  readonly maxDrawdownPercent: number;
  readonly totalTrades: number;
}
