import { Injectable } from '@nestjs/common';
import { TradingReport } from '../../domain/models/report.model';

/**
 * JsonReportExporterService serialises a TradingReport to a JSON string.
 *
 * The output is a single JSON object that exactly mirrors the TradingReport
 * interface, pretty-printed with 2-space indentation for readability.
 *
 * No file I/O is performed — callers receive the raw string and decide
 * where to write it (filesystem, object storage, HTTP response, etc.).
 */
@Injectable()
export class JsonReportExporterService {
  /** Returns the full report as pretty-printed JSON. */
  export(report: TradingReport): string {
    return JSON.stringify(report, null, 2);
  }

  /** Returns a compact (no whitespace) JSON string for transport/archival. */
  exportCompact(report: TradingReport): string {
    return JSON.stringify(report);
  }

  /** Returns a JSON summary (metadata + key metrics only) for quick listings. */
  exportSummary(report: TradingReport): string {
    return JSON.stringify(
      {
        reportId: report.reportId,
        version: report.version,
        generatedAt: report.generatedAt,
        title: report.title,
        period: report.period,
        source: report.source,
        sessionId: report.sessionId,
        strategyIds: report.strategyIds,
        periodStartDate: report.periodStartDate,
        periodEndDate: report.periodEndDate,
        status: report.status,

        // Executive summary KPIs
        netProfit: report.executiveSummary.netPnl,
        totalReturnPercent: report.executiveSummary.totalReturnPercent,
        annualizedReturnPercent: report.executiveSummary.annualizedReturnPercent,
        sharpeRatio: report.executiveSummary.sharpeRatio,
        maxDrawdownPercent: report.executiveSummary.maxDrawdownPercent,
        totalTrades: report.executiveSummary.totalTrades,
        winRate: report.executiveSummary.winRate,
        profitFactor: report.executiveSummary.profitFactor,
        expectancy: report.executiveSummary.expectancy,
        executionScore: report.executionQuality.executionScore,

        highlights: report.executiveSummary.highlights,
        riskAlerts: report.recommendations.riskAlerts,
        generationDurationMs: report.generationDurationMs,
      },
      null,
      2,
    );
  }
}
