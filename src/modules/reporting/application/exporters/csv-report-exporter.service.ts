import { Injectable } from '@nestjs/common';
import { TradingReport } from '../../domain/models/report.model';

/**
 * CsvReportExporterService serialises a TradingReport to a map of CSV strings.
 *
 * Each section produces its own CSV file. Callers receive a Map<filename, csv>
 * and can decide how to write or bundle the files.
 *
 * Design: each method is self-contained and can be called independently
 * when only a specific section is needed.
 */
@Injectable()
export class CsvReportExporterService {
  /**
   * Export all sections to a map of { filename → csv string }.
   * Suitable for zip archival or multi-file writing.
   */
  exportAll(report: TradingReport): Map<string, string> {
    const files = new Map<string, string>();
    const prefix = this.filePrefix(report);

    files.set(`${prefix}_executive_summary.csv`, this.exportExecutiveSummary(report));
    files.set(`${prefix}_portfolio_performance.csv`, this.exportPortfolioPerformance(report));
    files.set(`${prefix}_trade_summary.csv`, this.exportTradeSummary(report));
    files.set(`${prefix}_risk_metrics.csv`, this.exportRiskMetrics(report));
    files.set(`${prefix}_drawdown_analysis.csv`, this.exportDrawdownAnalysis(report));
    files.set(`${prefix}_execution_quality.csv`, this.exportExecutionQuality(report));
    files.set(`${prefix}_exposure_analysis.csv`, this.exportExposureAnalysis(report));
    files.set(`${prefix}_recommendations.csv`, this.exportRecommendations(report));
    files.set(`${prefix}_equity_curve.csv`, this.exportEquityCurve(report));
    files.set(`${prefix}_monthly_returns.csv`, this.exportMonthlyReturns(report));
    files.set(`${prefix}_trade_distribution.csv`, this.exportTradeDistribution(report));

    if (report.strategyComparison) {
      files.set(`${prefix}_strategy_comparison.csv`, this.exportStrategyComparison(report));
    }

    return files;
  }

  exportExecutiveSummary(report: TradingReport): string {
    const s = report.executiveSummary;
    return this.kvCsv([
      ['report_id', report.reportId],
      ['version', String(report.version)],
      ['title', s.title],
      ['period_label', s.periodLabel],
      ['source_label', s.sourceLabel],
      ['generated_at', s.generatedAt],
      ['net_pnl', this.fmt(s.netPnl)],
      ['net_pnl_percent', this.pct(s.netPnlPercent)],
      ['total_return_percent', this.pct(s.totalReturnPercent)],
      ['annualized_return_percent', this.pct(s.annualizedReturnPercent)],
      ['sharpe_ratio', this.fmt(s.sharpeRatio)],
      ['sortino_ratio', this.fmt(s.sortinoRatio)],
      ['calmar_ratio', this.fmt(s.calmarRatio)],
      ['max_drawdown_percent', this.pct(s.maxDrawdownPercent)],
      ['total_trades', String(s.totalTrades)],
      ['win_rate', this.pct(s.winRate * 100)],
      ['profit_factor', this.fmt(s.profitFactor)],
      ['expectancy', this.fmt(s.expectancy)],
      ['rolling_30d_return_percent', this.pct(s.rolling30dReturnPercent)],
      ['rolling_30d_sharpe', this.fmt(s.rolling30dSharpe)],
      ['is_profit', String(s.isProfit)],
    ]);
  }

  exportPortfolioPerformance(report: TradingReport): string {
    const p = report.portfolioPerformance;
    return this.kvCsv([
      ['initial_capital', this.fmt(p.initialCapital)],
      ['final_equity', this.fmt(p.finalEquity)],
      ['current_balance', this.fmt(p.currentBalance)],
      ['buying_power', this.fmt(p.buyingPower)],
      ['net_profit', this.fmt(p.netProfit)],
      ['gross_profit', this.fmt(p.grossProfit)],
      ['gross_loss', this.fmt(p.grossLoss)],
      ['realized_pnl', this.fmt(p.realizedPnl)],
      ['unrealized_pnl', this.fmt(p.unrealizedPnl)],
      ['total_commissions', this.fmt(p.totalCommissions)],
      ['total_return_percent', this.pct(p.totalReturnPercent)],
      ['annualized_return_percent', this.pct(p.annualizedReturnPercent)],
      ['average_equity', this.fmt(p.averageEquity)],
      ['peak_equity', this.fmt(p.peakEquity)],
      ['peak_equity_date', p.peakEquityDate],
      ['trough_equity', this.fmt(p.troughEquity)],
      ['trough_equity_date', p.troughEquityDate],
      ['leverage_utilization', this.fmt(p.leverageUtilization)],
      ['margin_utilization_pct', this.pct(p.marginUtilizationPercent)],
      ['cash_utilization_pct', this.pct(p.cashUtilizationPercent)],
      ['profit_factor', this.fmt(p.profitFactor)],
      ['recovery_factor', this.fmt(p.recoveryFactor)],
      ['payoff_ratio', this.fmt(p.payoffRatio)],
    ]);
  }

  exportTradeSummary(report: TradingReport): string {
    const t = report.tradeSummary;
    return this.kvCsv([
      ['total_trades', String(t.totalTrades)],
      ['winning_trades', String(t.winningTrades)],
      ['losing_trades', String(t.losingTrades)],
      ['break_even_trades', String(t.breakEvenTrades)],
      ['win_rate', this.pct(t.winRate * 100)],
      ['loss_rate', this.pct(t.lossRate * 100)],
      ['average_trade', this.fmt(t.averageTrade)],
      ['median_trade', this.fmt(t.medianTrade)],
      ['largest_win', this.fmt(t.largestWin)],
      ['largest_loss', this.fmt(t.largestLoss)],
      ['average_win', this.fmt(t.averageWin)],
      ['average_loss', this.fmt(t.averageLoss)],
      ['profit_factor', this.fmt(t.profitFactor)],
      ['expectancy', this.fmt(t.expectancy)],
      ['payoff_ratio', this.fmt(t.payoffRatio)],
      ['risk_reward_ratio', this.fmt(t.riskRewardRatio)],
      ['max_consecutive_wins', String(t.maxConsecutiveWins)],
      ['max_consecutive_losses', String(t.maxConsecutiveLosses)],
      ['avg_holding_time_ms', String(Math.round(t.averageHoldingTimeMs))],
      ['avg_holding_time_formatted', t.averageHoldingTimeFormatted],
      ['trade_frequency_per_day', this.fmt(t.tradeFrequencyPerDay)],
      ['trade_frequency_per_week', this.fmt(t.tradeFrequencyPerWeek)],
      ['longest_flat_period_ms', String(t.longestFlatPeriodMs)],
      ['longest_flat_formatted', t.longestFlatPeriodFormatted],
    ]);
  }

  exportRiskMetrics(report: TradingReport): string {
    const r = report.riskMetrics;
    return this.kvCsv([
      ['sharpe_ratio', this.fmt(r.sharpeRatio)],
      ['sortino_ratio', this.fmt(r.sortinoRatio)],
      ['calmar_ratio', this.fmt(r.calmarRatio)],
      ['omega_ratio', this.fmt(r.omegaRatio)],
      ['treynor_ratio', this.fmt(r.treynorRatio)],
      ['information_ratio', this.fmt(r.informationRatio)],
      ['max_drawdown', this.fmt(r.maxDrawdown)],
      ['max_drawdown_percent', this.pct(r.maxDrawdownPercent)],
      ['max_drawdown_absolute', this.fmt(r.maxDrawdownAbsolute)],
      ['average_drawdown_percent', this.pct(r.averageDrawdown * 100)],
      ['ulcer_index', this.fmt(r.ulcerIndex)],
      ['pain_index', this.fmt(r.painIndex)],
      ['rolling_7d_sharpe', this.fmt(r.rolling7dSharpe)],
      ['rolling_30d_sharpe', this.fmt(r.rolling30dSharpe)],
      ['rolling_90d_sharpe', this.fmt(r.rolling90dSharpe)],
      ['rolling_7d_sortino', this.fmt(r.rolling7dSortino)],
      ['rolling_30d_sortino', this.fmt(r.rolling30dSortino)],
      ['rolling_90d_sortino', this.fmt(r.rolling90dSortino)],
      ['rolling_7d_return_pct', this.pct(r.rolling7dReturnPercent)],
      ['rolling_30d_return_pct', this.pct(r.rolling30dReturnPercent)],
      ['rolling_90d_return_pct', this.pct(r.rolling90dReturnPercent)],
      ['rolling_180d_return_pct', this.pct(r.rolling180dReturnPercent)],
      ['rolling_365d_return_pct', this.pct(r.rolling365dReturnPercent)],
      ['daily_7d_volatility', this.fmt(r.daily7dVolatility)],
      ['daily_30d_volatility', this.fmt(r.daily30dVolatility)],
      ['annualized_volatility', this.fmt(r.annualizedVolatility)],
    ]);
  }

  exportDrawdownAnalysis(report: TradingReport): string {
    const d = report.drawdownAnalysis;
    const summaryRows: [string, string][] = [
      ['is_in_drawdown', String(d.isInDrawdown)],
      ['current_drawdown_pct', this.pct(d.currentDrawdownPercent)],
      ['current_drawdown_absolute', this.fmt(d.currentDrawdownAbsolute)],
      ['drawdown_start_date', d.drawdownStartDate ?? ''],
      ['max_drawdown_pct', this.pct(d.maxDrawdownPercent)],
      ['max_drawdown_absolute', this.fmt(d.maxDrawdownAbsolute)],
      ['average_drawdown_pct', this.pct(d.averageDrawdownPercent)],
      ['ulcer_index', this.fmt(d.ulcerIndex)],
      ['pain_index', this.fmt(d.painIndex)],
      ['total_drawdown_periods', String(d.totalDrawdownPeriods)],
      ['longest_drawdown_ms', String(d.longestDrawdownMs)],
      ['average_recovery_ms', String(Math.round(d.averageRecoveryMs))],
    ];

    const summarySection = this.kvCsv(summaryRows);

    if (d.top5Drawdowns.length === 0) return summarySection;

    const ddHeaders = [
      'rank',
      'start_date',
      'trough_date',
      'end_date',
      'depth_pct',
      'depth_absolute',
      'equity_at_peak',
      'equity_at_trough',
      'duration_ms',
      'recovery_ms',
    ];
    const ddRows = d.top5Drawdowns.map((dd) => [
      String(dd.rank),
      dd.startDate,
      dd.troughDate,
      dd.endDate ?? 'ongoing',
      this.pct(dd.depthPercent * 100),
      this.fmt(dd.depthAbsolute),
      this.fmt(dd.equityAtPeak),
      this.fmt(dd.equityAtTrough),
      String(dd.durationMs),
      dd.recoveryMs !== null ? String(dd.recoveryMs) : 'ongoing',
    ]);

    return summarySection + '\n\n' + this.buildCsv([ddHeaders], ddRows);
  }

  exportStrategyComparison(report: TradingReport): string {
    if (!report.strategyComparison)
      return 'strategy_id,message\n(none),No strategy comparison in this report';

    const s = report.strategyComparison;
    const headers = [
      'strategy_id',
      'strategy_label',
      'net_profit',
      'total_return_pct',
      'annualized_return_pct',
      'sharpe',
      'sortino',
      'calmar',
      'max_drawdown_pct',
      'total_trades',
      'win_rate',
      'expectancy',
      'profit_factor',
    ];

    const rows = s.strategies.map((r) => [
      r.strategyId,
      r.strategyLabel,
      this.fmt(r.netProfit),
      this.pct(r.totalReturnPercent),
      this.pct(r.annualizedReturnPercent),
      this.fmt(r.sharpeRatio),
      this.fmt(r.sortinoRatio),
      this.fmt(r.calmarRatio),
      this.pct(r.maxDrawdownPercent),
      String(r.totalTrades),
      this.pct(r.winRate * 100),
      this.fmt(r.expectancy),
      this.fmt(r.profitFactor),
    ]);

    const winners = this.kvCsv([
      ['best_by_return', s.bestByReturn],
      ['best_by_sharpe', s.bestBySharpe],
      ['best_by_sortino', s.bestBySortino],
      ['best_by_calmar', s.bestByCalmar],
      ['best_by_drawdown', s.bestByDrawdown],
      ['best_by_expectancy', s.bestByExpectancy],
      ['best_by_profit_factor', s.bestByProfitFactor],
    ]);

    return this.buildCsv([headers], rows) + '\n\n' + winners;
  }

  exportExecutionQuality(report: TradingReport): string {
    const e = report.executionQuality;
    return this.kvCsv([
      ['average_slippage', this.fmt(e.averageSlippage)],
      ['median_slippage', this.fmt(e.medianSlippage)],
      ['worst_slippage', this.fmt(e.worstSlippage)],
      ['total_slippage', this.fmt(e.totalSlippage)],
      ['slippage_pct_of_pnl', this.fmt(e.slippageAsPercentOfPnl * 100)],
      ['average_latency_ms', this.fmt(e.averageLatencyMs)],
      ['median_latency_ms', this.fmt(e.medianLatencyMs)],
      ['p95_latency_ms', this.fmt(e.p95LatencyMs)],
      ['max_latency_ms', this.fmt(e.maxLatencyMs)],
      ['order_fill_rate', this.pct(e.orderFillRate * 100)],
      ['cancel_rate', this.pct(e.cancelRate * 100)],
      ['partial_fill_rate', this.pct(e.partialFillRate * 100)],
      ['rejected_order_rate', this.pct(e.rejectedOrderRate * 100)],
      ['total_fills', String(e.totalFills)],
      ['total_commission', this.fmt(e.totalCommission)],
      ['commission_pct_of_pnl', this.fmt(e.commissionAsPercentOfPnl * 100)],
      ['execution_score', String(e.executionScore)],
    ]);
  }

  exportExposureAnalysis(report: TradingReport): string {
    const e = report.exposureAnalysis;
    const summary = this.kvCsv([
      ['gross_exposure', this.fmt(e.grossExposure)],
      ['net_exposure', this.fmt(e.netExposure)],
      ['long_exposure', this.fmt(e.longExposure)],
      ['short_exposure', this.fmt(e.shortExposure)],
      ['leverage_utilization', this.fmt(e.leverageUtilization)],
      ['margin_utilization_pct', this.pct(e.marginUtilizationPercent)],
      ['cash_utilization_pct', this.pct(e.cashUtilizationPercent)],
      ['open_position_count', String(e.openPositionCount)],
      ['long_position_count', String(e.longPositionCount)],
      ['short_position_count', String(e.shortPositionCount)],
    ]);

    const symHeaders = ['symbol', 'direction', 'notional', 'pct_of_equity', 'unrealized_pnl'];
    const symRows = e.topSymbolsByExposure.map((s) => [
      s.symbol,
      s.direction,
      this.fmt(s.notional),
      this.pct(s.percentOfEquity * 100),
      this.fmt(s.unrealizedPnl),
    ]);

    return summary + '\n\n' + this.buildCsv([symHeaders], symRows);
  }

  exportRecommendations(report: TradingReport): string {
    const r = report.recommendations;
    const headers = ['priority', 'category', 'message', 'data_point'];
    const rows = r.items.map((item) => [
      item.priority,
      item.category,
      item.message,
      item.dataPoint,
    ]);
    return this.buildCsv([headers], rows);
  }

  exportEquityCurve(report: TradingReport): string {
    const headers = ['date', 'timestamp', 'equity', 'balance', 'drawdown_pct'];
    const equity = report.charts.equityCurve;
    const balance = report.charts.balanceCurve;
    const dd = report.charts.drawdownCurve;

    const rows = equity.map((pt, i) => [
      pt.date,
      String(pt.timestamp),
      this.fmt(pt.value),
      balance[i] ? this.fmt(balance[i]!.value) : '',
      dd[i] ? this.fmt(dd[i]!.value) : '',
    ]);

    return this.buildCsv([headers], rows);
  }

  exportMonthlyReturns(report: TradingReport): string {
    const headers = ['year', 'month', 'label', 'return_pct', 'is_profit'];
    const rows = report.charts.monthlyReturns.map((m) => [
      String(m.year),
      String(m.month),
      m.label,
      this.pct(m.returnPercent),
      String(m.isProfit),
    ]);
    return this.buildCsv([headers], rows);
  }

  exportTradeDistribution(report: TradingReport): string {
    const headers = ['bucket', 'range_min', 'range_max', 'count', 'frequency'];
    const rows = report.charts.tradeDistribution.map((b) => [
      b.label,
      this.fmt(b.rangeMin),
      this.fmt(b.rangeMax),
      String(b.count),
      this.fmt(b.frequency),
    ]);
    return this.buildCsv([headers], rows);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private filePrefix(report: TradingReport): string {
    return [
      report.source.toLowerCase(),
      report.period.toLowerCase(),
      report.periodStartDate,
      `v${report.version}`,
    ].join('_');
  }

  private kvCsv(pairs: [string, string][]): string {
    return ['key,value', ...pairs.map(([k, v]) => `${k},${this.escape(v)}`)].join('\n');
  }

  private buildCsv(headerRows: string[][], dataRows: string[][]): string {
    return [...headerRows, ...dataRows]
      .map((row) => row.map((cell) => this.escape(cell)).join(','))
      .join('\n');
  }

  private escape(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return '"' + value.replace(/"/g, '""') + '"';
    }
    return value;
  }

  private fmt(v: number): string {
    return isFinite(v) ? v.toFixed(4) : v > 0 ? 'Inf' : '-Inf';
  }

  private pct(v: number): string {
    return isFinite(v) ? v.toFixed(2) : v > 0 ? 'Inf' : '-Inf';
  }
}
