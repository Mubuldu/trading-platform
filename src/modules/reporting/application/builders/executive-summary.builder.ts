import { Injectable } from '@nestjs/common';
import { AnalyticsSnapshot } from '@modules/analytics/domain/models/analytics-snapshot.model';
import { ExecutiveSummarySection } from '../../domain/models/sections/executive-summary.section';
import { ReportPeriod } from '../../domain/enums/report-period.enum';
import { ReportSource } from '../../domain/enums/report-source.enum';

/**
 * ExecutiveSummaryBuilder assembles the report's cover-page section.
 *
 * All inputs come from the latest AnalyticsSnapshot — no additional I/O.
 */
@Injectable()
export class ExecutiveSummaryBuilder {
  build(
    snapshot: AnalyticsSnapshot,
    period: ReportPeriod,
    source: ReportSource,
    periodStartDate: string,
    periodEndDate: string,
  ): ExecutiveSummarySection {
    const { performance: p, riskMetrics: r, rollingMetrics: rm } = snapshot;

    const title = this.buildTitle(period, source, periodStartDate, periodEndDate);
    const periodLabel = this.buildPeriodLabel(period, periodStartDate, periodEndDate);
    const sourceLabel = this.buildSourceLabel(source);
    const highlights = this.buildHighlights(snapshot);

    return {
      title,
      periodLabel,
      sourceLabel,
      generatedAt: new Date(snapshot.computedAt).toISOString(),

      netPnl: p.netProfit,
      netPnlPercent: p.totalReturnPercent,
      totalReturn: p.netProfit,
      totalReturnPercent: p.totalReturnPercent,
      annualizedReturnPercent: p.annualizedReturnPercent,

      sharpeRatio: r.sharpeRatio,
      sortinoRatio: r.sortinoRatio,
      calmarRatio: r.calmarRatio,
      maxDrawdown: r.maxDrawdown,
      maxDrawdownPercent: r.maxDrawdown * 100,

      totalTrades: p.totalTrades,
      winRate: p.winningPercent,
      profitFactor: p.profitFactor,
      expectancy: p.expectancy,

      rolling30dReturnPercent: rm.thirtyDay.totalReturnPercent,
      rolling30dSharpe: rm.thirtyDay.sharpeRatio,

      isProfit: p.netProfit > 0,
      isPositiveSharpe: r.sharpeRatio > 0,

      highlights,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private buildTitle(
    period: ReportPeriod,
    source: ReportSource,
    startDate: string,
    endDate: string,
  ): string {
    const sourceLabel = this.buildSourceLabel(source);

    switch (period) {
      case ReportPeriod.DAILY:
        return `${sourceLabel} Daily Report — ${startDate}`;
      case ReportPeriod.WEEKLY:
        return `${sourceLabel} Weekly Report — ${startDate} to ${endDate}`;
      case ReportPeriod.MONTHLY: {
        const [year, month] = startDate.split('-');
        const monthName = new Date(Number(year), Number(month) - 1, 1).toLocaleString('en-US', {
          month: 'long',
        });
        return `${sourceLabel} Monthly Report — ${monthName} ${year}`;
      }
      case ReportPeriod.QUARTERLY: {
        const [year, month] = startDate.split('-');
        const q = Math.ceil(Number(month) / 3);
        return `${sourceLabel} Quarterly Report — Q${q} ${year}`;
      }
      case ReportPeriod.YEARLY: {
        const [year] = startDate.split('-');
        return `${sourceLabel} Annual Report — ${year}`;
      }
      case ReportPeriod.CUSTOM:
        return `${sourceLabel} Custom Report — ${startDate} to ${endDate}`;
    }
  }

  private buildPeriodLabel(period: ReportPeriod, startDate: string, endDate: string): string {
    const fmt = (d: string): string => {
      const [y, m, day] = d.split('-').map(Number);
      return new Date(y!, m! - 1, day!).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
    };

    switch (period) {
      case ReportPeriod.DAILY:
        return `${fmt(startDate)} (Daily)`;
      case ReportPeriod.WEEKLY:
        return `${fmt(startDate)} – ${fmt(endDate)} (Weekly)`;
      case ReportPeriod.MONTHLY:
        return `${fmt(startDate)} – ${fmt(endDate)} (Monthly)`;
      case ReportPeriod.QUARTERLY:
        return `${fmt(startDate)} – ${fmt(endDate)} (Quarterly)`;
      case ReportPeriod.YEARLY:
        return `${fmt(startDate)} – ${fmt(endDate)} (Annual)`;
      case ReportPeriod.CUSTOM:
        return `${fmt(startDate)} – ${fmt(endDate)} (Custom)`;
    }
  }

  private buildSourceLabel(source: ReportSource): string {
    const map: Record<ReportSource, string> = {
      BACKTEST: 'Backtest',
      PAPER: 'Paper Trading',
      LIVE: 'Live Trading',
      MULTI_SOURCE: 'Multi-Source',
    };
    return map[source];
  }

  private buildHighlights(snapshot: AnalyticsSnapshot): string[] {
    const { performance: p, riskMetrics: r } = snapshot;
    const highlights: string[] = [];

    // Net return
    const sign = p.netProfit >= 0 ? '+' : '';
    highlights.push(
      `Net P&L: ${sign}${p.netProfit.toFixed(2)} (${sign}${p.totalReturnPercent.toFixed(2)}%)`,
    );

    // Sharpe
    highlights.push(
      `Sharpe Ratio: ${r.sharpeRatio.toFixed(2)} ` +
        `(${r.sharpeRatio >= 1 ? 'good' : r.sharpeRatio >= 0 ? 'marginal' : 'negative'})`,
    );

    // Drawdown
    highlights.push(
      `Max Drawdown: ${(r.maxDrawdown * 100).toFixed(2)}% ` +
        `(${r.maxDrawdown <= 0.05 ? 'low' : r.maxDrawdown <= 0.15 ? 'moderate' : 'high'} risk)`,
    );

    return highlights;
  }
}
