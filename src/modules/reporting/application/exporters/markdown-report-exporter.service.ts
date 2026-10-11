import { Injectable } from '@nestjs/common';
import { TradingReport } from '../../domain/models/report.model';
import { DrawdownPeriod } from '../../domain/models/sections/drawdown-analysis.section';

/**
 * MarkdownReportExporterService serialises a TradingReport to Markdown.
 *
 * The output is a single, self-contained Markdown document with all sections
 * formatted as tables and prose. Suitable for viewing in GitHub, Obsidian,
 * or any Markdown renderer.
 *
 * No file I/O is performed — callers receive the raw string.
 */
@Injectable()
export class MarkdownReportExporterService {
  export(report: TradingReport): string {
    const sections: string[] = [
      this.header(report),
      this.executiveSummary(report),
      this.portfolioPerformance(report),
      this.tradeSummary(report),
      this.riskMetrics(report),
      this.drawdownAnalysis(report),
      this.executionQuality(report),
      this.exposureAnalysis(report),
      report.charts.monthlyReturns.length > 0 ? this.monthlyReturns(report) : '',
      report.strategyComparison ? this.strategyComparison(report) : '',
      this.recommendations(report),
      this.footer(report),
    ];

    return sections.filter(Boolean).join('\n\n---\n\n');
  }

  // ── Section renderers ──────────────────────────────────────────────────────

  private header(report: TradingReport): string {
    const s = report.executiveSummary;
    const badge = s.isProfit ? '🟢' : '🔴';

    return [
      `# ${badge} ${report.title}`,
      '',
      `**Generated:** ${s.generatedAt}  `,
      `**Source:** ${s.sourceLabel}  `,
      `**Period:** ${s.periodLabel}  `,
      `**Report ID:** \`${report.reportId}\` (v${report.version})  `,
      `**Snapshots:** ${report.snapshotIds.length} analytics snapshot(s) used`,
      '',
      '### Highlights',
      ...s.highlights.map((h) => `- ${h}`),
    ].join('\n');
  }

  private executiveSummary(report: TradingReport): string {
    const s = report.executiveSummary;

    return [
      '## Executive Summary',
      '',
      '| Metric | Value |',
      '|--------|-------|',
      `| Net P&L | **${this.money(s.netPnl)}** (${this.pct(s.netPnlPercent)}%) |`,
      `| Total Return | ${this.pct(s.totalReturnPercent)}% |`,
      `| Annualised Return | ${this.pct(s.annualizedReturnPercent)}% |`,
      `| Sharpe Ratio | ${this.dec(s.sharpeRatio)} |`,
      `| Sortino Ratio | ${this.dec(s.sortinoRatio)} |`,
      `| Calmar Ratio | ${this.dec(s.calmarRatio)} |`,
      `| Max Drawdown | ${this.pct(s.maxDrawdownPercent)}% |`,
      `| Total Trades | ${s.totalTrades} |`,
      `| Win Rate | ${this.pct(s.winRate * 100)}% |`,
      `| Profit Factor | ${this.dec(s.profitFactor)} |`,
      `| Expectancy | ${this.money(s.expectancy)} |`,
      `| 30d Rolling Return | ${this.pct(s.rolling30dReturnPercent)}% |`,
      `| 30d Rolling Sharpe | ${this.dec(s.rolling30dSharpe)} |`,
    ].join('\n');
  }

  private portfolioPerformance(report: TradingReport): string {
    const p = report.portfolioPerformance;

    return [
      '## Portfolio Performance',
      '',
      '### Capital',
      '',
      '| | Value |',
      '|---|---|',
      `| Initial Capital | ${this.money(p.initialCapital)} |`,
      `| Final Equity | ${this.money(p.finalEquity)} |`,
      `| Current Balance | ${this.money(p.currentBalance)} |`,
      `| Buying Power | ${this.money(p.buyingPower)} |`,
      `| Peak Equity | ${this.money(p.peakEquity)} (${p.peakEquityDate}) |`,
      `| Trough Equity | ${this.money(p.troughEquity)} (${p.troughEquityDate}) |`,
      '',
      '### P&L Attribution',
      '',
      '| | Value |',
      '|---|---|',
      `| Net Profit | **${this.money(p.netProfit)}** |`,
      `| Gross Profit | ${this.money(p.grossProfit)} |`,
      `| Gross Loss | ${this.money(p.grossLoss)} |`,
      `| Realised P&L | ${this.money(p.realizedPnl)} |`,
      `| Unrealised P&L | ${this.money(p.unrealizedPnl)} |`,
      `| Total Commissions | ${this.money(p.totalCommissions)} |`,
      '',
      '### Returns & Ratios',
      '',
      '| | Value |',
      '|---|---|',
      `| Total Return | ${this.pct(p.totalReturnPercent)}% |`,
      `| Annualised Return | ${this.pct(p.annualizedReturnPercent)}% |`,
      `| Profit Factor | ${this.dec(p.profitFactor)} |`,
      `| Recovery Factor | ${this.dec(p.recoveryFactor)} |`,
      `| Payoff Ratio | ${this.dec(p.payoffRatio)} |`,
      `| Leverage Utilisation | ${this.dec(p.leverageUtilization)}× |`,
      `| Cash Utilisation | ${this.pct(p.cashUtilizationPercent)}% |`,
    ].join('\n');
  }

  private tradeSummary(report: TradingReport): string {
    const t = report.tradeSummary;

    return [
      '## Trade Summary',
      '',
      '### Counts',
      '',
      '| | Value |',
      '|---|---|',
      `| Total Trades | ${t.totalTrades} |`,
      `| Winning | ${t.winningTrades} (${this.pct(t.winRate * 100)}%) |`,
      `| Losing | ${t.losingTrades} (${this.pct(t.lossRate * 100)}%) |`,
      `| Break-even | ${t.breakEvenTrades} |`,
      `| Max Consecutive Wins | ${t.maxConsecutiveWins} |`,
      `| Max Consecutive Losses | ${t.maxConsecutiveLosses} |`,
      '',
      '### P&L Per Trade',
      '',
      '| | Value |',
      '|---|---|',
      `| Average Trade | ${this.money(t.averageTrade)} |`,
      `| Median Trade | ${this.money(t.medianTrade)} |`,
      `| Average Win | ${this.money(t.averageWin)} |`,
      `| Average Loss | ${this.money(t.averageLoss)} |`,
      `| Largest Win | ${this.money(t.largestWin)} |`,
      `| Largest Loss | ${this.money(t.largestLoss)} |`,
      `| Expectancy | ${this.money(t.expectancy)} |`,
      `| Profit Factor | ${this.dec(t.profitFactor)} |`,
      `| Payoff Ratio | ${this.dec(t.payoffRatio)} |`,
      '',
      '### Timing',
      '',
      '| | Value |',
      '|---|---|',
      `| Avg Holding Time | ${t.averageHoldingTimeFormatted} |`,
      `| Trade Frequency | ${this.dec(t.tradeFrequencyPerDay)}/day |`,
      `| Longest Flat Period | ${t.longestFlatPeriodFormatted} |`,
    ].join('\n');
  }

  private riskMetrics(report: TradingReport): string {
    const r = report.riskMetrics;

    return [
      '## Risk Metrics',
      '',
      '### Risk-Adjusted Ratios',
      '',
      '| Metric | All-Time | 7d | 30d | 90d |',
      '|--------|----------|----|-----|-----|',
      `| Sharpe | ${this.dec(r.sharpeRatio)} | ${this.dec(r.rolling7dSharpe)} | ${this.dec(r.rolling30dSharpe)} | ${this.dec(r.rolling90dSharpe)} |`,
      `| Sortino | ${this.dec(r.sortinoRatio)} | ${this.dec(r.rolling7dSortino)} | ${this.dec(r.rolling30dSortino)} | ${this.dec(r.rolling90dSortino)} |`,
      `| Return % | — | ${this.pct(r.rolling7dReturnPercent)}% | ${this.pct(r.rolling30dReturnPercent)}% | ${this.pct(r.rolling90dReturnPercent)}% |`,
      '',
      '### Additional Ratios',
      '',
      '| Metric | Value |',
      '|--------|-------|',
      `| Calmar | ${this.dec(r.calmarRatio)} |`,
      `| Omega | ${this.dec(r.omegaRatio)} |`,
      `| Treynor | ${this.dec(r.treynorRatio)} |`,
      `| Information Ratio | ${this.dec(r.informationRatio)} |`,
      '',
      '### Drawdown',
      '',
      '| Metric | Value |',
      '|--------|-------|',
      `| Max Drawdown | ${this.pct(r.maxDrawdownPercent)}% (${this.money(r.maxDrawdownAbsolute)}) |`,
      `| Avg Drawdown | ${this.pct(r.averageDrawdown * 100)}% |`,
      `| Ulcer Index | ${this.dec(r.ulcerIndex)} |`,
      `| Pain Index | ${this.dec(r.painIndex)} |`,
      '',
      '### Volatility',
      '',
      '| | 7d Daily | 30d Daily | Annualised |',
      '|---|---|---|---|',
      `| Volatility | ${this.pct(r.daily7dVolatility * 100)}% | ${this.pct(r.daily30dVolatility * 100)}% | ${this.pct(r.annualizedVolatility * 100)}% |`,
    ].join('\n');
  }

  private drawdownAnalysis(report: TradingReport): string {
    const d = report.drawdownAnalysis;

    const currentStatus = d.isInDrawdown
      ? `🔴 **In Drawdown** since ${d.drawdownStartDate} (${this.pct(d.currentDrawdownPercent)}% / ${this.money(d.currentDrawdownAbsolute)})`
      : '🟢 **Not in drawdown**';

    const top5Rows = d.top5Drawdowns.map((dd: DrawdownPeriod) =>
      [
        `| ${dd.rank}`,
        `${dd.startDate}`,
        `${dd.troughDate}`,
        `${dd.endDate ?? 'ongoing'}`,
        `${this.pct(dd.depthPercent * 100)}%`,
        `${this.money(dd.depthAbsolute)}`,
        `${this.msDuration(dd.durationMs)}`,
        `${dd.recoveryMs !== null ? this.msDuration(dd.recoveryMs) : 'ongoing'} |`,
      ].join(' | '),
    );

    return [
      '## Drawdown Analysis',
      '',
      currentStatus,
      '',
      '| Metric | Value |',
      '|--------|-------|',
      `| Max Drawdown | ${this.pct(d.maxDrawdownPercent)}% (${this.money(d.maxDrawdownAbsolute)}) |`,
      `| Average Drawdown | ${this.pct(d.averageDrawdownPercent)}% |`,
      `| Total Drawdown Periods | ${d.totalDrawdownPeriods} |`,
      `| Longest Drawdown | ${this.msDuration(d.longestDrawdownMs)} |`,
      `| Average Recovery | ${this.msDuration(d.averageRecoveryMs)} |`,
      `| Ulcer Index | ${this.dec(d.ulcerIndex)} |`,
      `| Pain Index | ${this.dec(d.painIndex)} |`,
      '',
      d.top5Drawdowns.length > 0
        ? [
            '### Top Drawdowns',
            '',
            '| # | Start | Trough | End | Depth % | Depth $ | Duration | Recovery |',
            '|---|-------|--------|-----|---------|---------|----------|----------|',
            ...top5Rows,
          ].join('\n')
        : '_No drawdown periods recorded._',
    ].join('\n');
  }

  private monthlyReturns(report: TradingReport): string {
    const rows = report.charts.monthlyReturns.map((m) => {
      const emoji = m.isProfit ? '🟢' : '🔴';
      const sign = m.returnPercent >= 0 ? '+' : '';
      return `| ${m.label} | ${emoji} ${sign}${m.returnPercent.toFixed(2)}% |`;
    });

    return ['## Monthly Returns', '', '| Month | Return |', '|-------|--------|', ...rows].join(
      '\n',
    );
  }

  private strategyComparison(report: TradingReport): string {
    if (!report.strategyComparison) return '';
    const s = report.strategyComparison;

    const rows = s.strategies.map(
      (r) =>
        `| ${r.strategyLabel} | ${this.money(r.netProfit)} | ${this.pct(r.totalReturnPercent)}% | ` +
        `${this.dec(r.sharpeRatio)} | ${this.dec(r.sortinoRatio)} | ${this.pct(r.maxDrawdownPercent)}% | ` +
        `${r.totalTrades} | ${this.pct(r.winRate * 100)}% | ${this.money(r.expectancy)} |`,
    );

    return [
      '## Strategy Comparison',
      '',
      '| Strategy | Net Profit | Return | Sharpe | Sortino | Max DD | Trades | Win Rate | Expectancy |',
      '|----------|-----------|--------|--------|---------|--------|--------|----------|-----------|',
      ...rows,
      '',
      '### Winners by Metric',
      '',
      '| Metric | Best Strategy |',
      '|--------|--------------|',
      `| Total Return | ${s.bestByReturn} |`,
      `| Sharpe Ratio | ${s.bestBySharpe} |`,
      `| Sortino Ratio | ${s.bestBySortino} |`,
      `| Calmar Ratio | ${s.bestByCalmar} |`,
      `| Lowest Drawdown | ${s.bestByDrawdown} |`,
      `| Expectancy | ${s.bestByExpectancy} |`,
      `| Profit Factor | ${s.bestByProfitFactor} |`,
    ].join('\n');
  }

  private executionQuality(report: TradingReport): string {
    const e = report.executionQuality;
    const score = e.executionScore;
    const scoreEmoji = score >= 80 ? '🟢' : score >= 60 ? '🟡' : '🔴';

    return [
      '## Execution Quality',
      '',
      `**Execution Score: ${scoreEmoji} ${score}/100**`,
      '',
      '### Slippage',
      '',
      '| Metric | Value |',
      '|--------|-------|',
      `| Average | ${this.money(e.averageSlippage)} |`,
      `| Median | ${this.money(e.medianSlippage)} |`,
      `| Worst | ${this.money(e.worstSlippage)} |`,
      `| Total | ${this.money(e.totalSlippage)} |`,
      `| As % of P&L | ${this.pct(e.slippageAsPercentOfPnl * 100)}% |`,
      '',
      '### Latency',
      '',
      '| Metric | Value |',
      '|--------|-------|',
      `| Average | ${this.dec(e.averageLatencyMs)} ms |`,
      `| Median | ${this.dec(e.medianLatencyMs)} ms |`,
      `| P95 | ${this.dec(e.p95LatencyMs)} ms |`,
      `| Max | ${this.dec(e.maxLatencyMs)} ms |`,
      '',
      '### Fill Quality',
      '',
      '| Metric | Value |',
      '|--------|-------|',
      `| Order Fill Rate | ${this.pct(e.orderFillRate * 100)}% |`,
      `| Cancel Rate | ${this.pct(e.cancelRate * 100)}% |`,
      `| Partial Fill Rate | ${this.pct(e.partialFillRate * 100)}% |`,
      `| Rejected Order Rate | ${this.pct(e.rejectedOrderRate * 100)}% |`,
      `| Total Fills | ${e.totalFills} |`,
      `| Total Commission | ${this.money(e.totalCommission)} |`,
      `| Commission as % of P&L | ${this.pct(e.commissionAsPercentOfPnl * 100)}% |`,
    ].join('\n');
  }

  private exposureAnalysis(report: TradingReport): string {
    const e = report.exposureAnalysis;

    const symRows = e.topSymbolsByExposure.map(
      (s) =>
        `| ${s.symbol} | ${s.direction} | ${this.money(s.notional)} | ${this.pct(s.percentOfEquity * 100)}% | ${this.money(s.unrealizedPnl)} |`,
    );

    return [
      '## Exposure Analysis',
      '',
      '| Metric | Value |',
      '|--------|-------|',
      `| Gross Exposure | ${this.money(e.grossExposure)} |`,
      `| Net Exposure | ${this.money(e.netExposure)} |`,
      `| Long Exposure | ${this.money(e.longExposure)} |`,
      `| Short Exposure | ${this.money(e.shortExposure)} |`,
      `| Leverage | ${this.dec(e.leverageUtilization)}× |`,
      `| Margin Utilisation | ${this.pct(e.marginUtilizationPercent)}% |`,
      `| Cash Utilisation | ${this.pct(e.cashUtilizationPercent)}% |`,
      `| Open Positions | ${e.openPositionCount} (${e.longPositionCount}L / ${e.shortPositionCount}S) |`,
      '',
      e.topSymbolsByExposure.length > 0
        ? [
            '### Top Positions',
            '',
            '| Symbol | Direction | Notional | % of Equity | Unrealised P&L |',
            '|--------|-----------|----------|-------------|----------------|',
            ...symRows,
          ].join('\n')
        : '_No open positions._',
    ].join('\n');
  }

  private recommendations(report: TradingReport): string {
    const r = report.recommendations;

    if (r.items.length === 0) {
      return [
        '## Recommendations',
        '',
        '✅ **No issues detected.** All metrics are within acceptable thresholds.',
      ].join('\n');
    }

    const emojiMap: Record<string, string> = { HIGH: '🔴', MEDIUM: '🟡', LOW: '🔵' };
    const rows = r.items.map(
      (item) =>
        `| ${emojiMap[item.priority] ?? ''} ${item.priority} | ${item.category} | ${item.message} | \`${item.dataPoint}\` |`,
    );

    return [
      '## Recommendations',
      '',
      `**${r.totalItems} recommendation(s):** ${r.highPriorityCount} high · ${r.mediumPriorityCount} medium · ${r.lowPriorityCount} low`,
      '',
      r.riskAlerts.length > 0
        ? '### ⚠️ Risk Alerts\n\n' + r.riskAlerts.map((a) => `- ${a}`).join('\n')
        : '',
      '',
      '| Priority | Category | Message | Data |',
      '|----------|----------|---------|------|',
      ...rows,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private footer(report: TradingReport): string {
    return [
      '---',
      '',
      `*Generated by Trading Platform Reporting Engine in ${report.generationDurationMs}ms.*  `,
      `*Report ID: \`${report.reportId}\` · Version ${report.version} · Status: ${report.status}*`,
    ].join('\n');
  }

  // ── Formatting helpers ──────────────────────────────────────────────────────

  private money(v: number): string {
    if (!isFinite(v)) return 'N/A';
    const sign = v >= 0 ? '+' : '';
    return `${sign}${v.toFixed(2)}`;
  }

  private pct(v: number): string {
    if (!isFinite(v)) return 'N/A';
    return v.toFixed(2);
  }

  private dec(v: number): string {
    if (!isFinite(v)) return 'N/A';
    return v.toFixed(2);
  }

  private msDuration(ms: number): string {
    if (ms <= 0) return '0s';
    const d = Math.floor(ms / 86_400_000);
    const h = Math.floor((ms % 86_400_000) / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const parts: string[] = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    return parts.join(' ') || '<1m';
  }
}
