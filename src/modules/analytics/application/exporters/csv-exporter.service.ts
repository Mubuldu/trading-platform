import { Injectable } from '@nestjs/common';
import { AnalyticsSnapshot } from '../../domain/models/analytics-snapshot.model';
import { CapitalCurvePoint } from '../../domain/models/capital-metrics.model';

/**
 * CsvExporterService serialises analytics data to CSV strings.
 *
 * Each export method produces a self-contained CSV with a header row.
 * No file I/O is performed — callers receive the raw string and decide
 * where to write it (filesystem, HTTP response, object storage, etc.).
 */
@Injectable()
export class CsvExporterService {
  // ── Top-level snapshot metrics ────────────────────────────────────────────────

  exportSnapshotSummary(snapshot: AnalyticsSnapshot): string {
    const { performance: p, riskMetrics: r, tradeMetrics: t, executionAnalytics: e } = snapshot;

    const headers = [
      'snapshot_id',
      'computed_at',
      'initial_capital',
      'final_equity',
      'net_profit',
      'total_return_pct',
      'annualized_return_pct',
      'sharpe_ratio',
      'sortino_ratio',
      'calmar_ratio',
      'max_drawdown',
      'profit_factor',
      'win_rate',
      'expectancy',
      'payoff_ratio',
      'total_trades',
      'winning_trades',
      'losing_trades',
      'average_win',
      'average_loss',
      'largest_win',
      'largest_loss',
      'max_consecutive_wins',
      'max_consecutive_losses',
      'average_holding_ms',
      'trade_frequency_per_day',
      'average_slippage',
      'average_latency_ms',
    ];

    const values = [
      snapshot.snapshotId,
      new Date(snapshot.computedAt).toISOString(),
      p.initialCapital,
      p.finalEquity,
      p.netProfit,
      this.pct(p.totalReturnPercent),
      this.pct(p.annualizedReturnPercent),
      this.fmt(r.sharpeRatio),
      this.fmt(r.sortinoRatio),
      this.fmt(r.calmarRatio),
      this.pct(r.maxDrawdown * 100),
      this.fmt(p.profitFactor),
      this.pct(p.winningPercent * 100),
      this.fmt(p.expectancy),
      this.fmt(p.payoffRatio),
      p.totalTrades,
      p.winningTrades,
      p.losingTrades,
      this.fmt(p.averageWin),
      this.fmt(p.averageLoss),
      this.fmt(p.largestWin),
      this.fmt(p.largestLoss),
      t.maxConsecutiveWins,
      t.maxConsecutiveLosses,
      Math.round(t.averageHoldingTimeMs),
      this.fmt(t.tradeFrequencyPerDay),
      this.fmt(e.averageSlippage),
      this.fmt(e.averageLatencyMs),
    ];

    return this.buildCsv([headers], [values.map(String)]);
  }

  // ── Equity curve ─────────────────────────────────────────────────────────────

  exportEquityCurve(snapshot: AnalyticsSnapshot): string {
    const headers = [
      'date',
      'timestamp',
      'equity',
      'cash_balance',
      'unrealized_pnl',
      'daily_return_pct',
      'cumulative_return_pct',
      'drawdown_pct',
    ];

    const rows = snapshot.capitalMetrics.equityCurve.map((p: CapitalCurvePoint) => [
      p.date,
      String(p.timestamp),
      this.fmt(p.equity),
      this.fmt(p.cashBalance),
      this.fmt(p.unrealizedPnl),
      this.pct(p.dailyReturn * 100),
      this.pct(p.cumulativeReturn * 100),
      this.pct(p.drawdownPercent * 100),
    ]);

    return this.buildCsv([headers], rows);
  }

  // ── Rolling metrics ───────────────────────────────────────────────────────────

  exportRollingMetrics(snapshot: AnalyticsSnapshot): string {
    const headers = [
      'window_days',
      'start_date',
      'end_date',
      'total_return_pct',
      'annualized_return_pct',
      'sharpe',
      'sortino',
      'calmar',
      'max_drawdown_pct',
      'total_trades',
      'win_rate_pct',
      'profit_factor',
      'net_profit',
      'daily_volatility',
      'annualized_volatility',
    ];

    const rm = snapshot.rollingMetrics;
    const windows = [
      rm.sevenDay,
      rm.thirtyDay,
      rm.ninetyDay,
      rm.oneEightyDay,
      rm.threeSixtyFiveDay,
    ];

    const rows = windows.map((w) => [
      String(w.windowDays),
      w.startDate,
      w.endDate,
      this.pct(w.totalReturnPercent),
      this.pct(w.annualizedReturnPercent),
      this.fmt(w.sharpeRatio),
      this.fmt(w.sortinoRatio),
      this.fmt(w.calmarRatio),
      this.pct(w.maxDrawdown * 100),
      String(w.totalTrades),
      this.pct(w.winRate * 100),
      this.fmt(w.profitFactor),
      this.fmt(w.netProfit),
      this.fmt(w.dailyVolatility),
      this.fmt(w.annualizedVolatility),
    ]);

    return this.buildCsv([headers], rows);
  }

  // ── Benchmark comparisons ─────────────────────────────────────────────────────

  exportBenchmarkComparisons(snapshot: AnalyticsSnapshot): string {
    const headers = [
      'benchmark',
      'period_start',
      'period_end',
      'strategy_return_pct',
      'benchmark_return_pct',
      'alpha',
      'beta',
      'correlation',
      'tracking_error',
      'information_ratio',
      'strategy_sharpe',
      'benchmark_sharpe',
      'outperformance_rate_pct',
      'outperformance_days',
      'underperformance_days',
    ];

    const rows = snapshot.benchmarkComparisons.map((b) => [
      b.benchmarkLabel,
      b.periodStartDate,
      b.periodEndDate,
      this.pct(b.strategyTotalReturnPercent),
      this.pct(b.benchmarkTotalReturnPercent),
      this.fmt(b.alpha),
      this.fmt(b.beta),
      this.fmt(b.correlation),
      this.fmt(b.trackingError),
      this.fmt(b.informationRatio),
      this.fmt(b.strategySharpe),
      this.fmt(b.benchmarkSharpe),
      this.pct(b.outperformanceRate * 100),
      String(b.outperformanceDays),
      String(b.underperformanceDays),
    ]);

    return this.buildCsv([headers], rows);
  }

  // ── Exposure breakdown ────────────────────────────────────────────────────────

  exportExposureBySymbol(snapshot: AnalyticsSnapshot): string {
    const headers = [
      'symbol',
      'direction',
      'quantity',
      'notional',
      'unrealized_pnl',
      'pct_of_equity',
    ];
    const rows = Object.entries(snapshot.exposureMetrics.bySymbol).map(([symbol, v]) => [
      symbol,
      v.direction,
      this.fmt(v.quantity),
      this.fmt(v.notional),
      this.fmt(v.unrealizedPnl),
      this.pct(v.percentOfEquity * 100),
    ]);
    return this.buildCsv([headers], rows);
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private buildCsv(headerRows: string[][], dataRows: string[][]): string {
    const lines = [...headerRows, ...dataRows].map((row) =>
      row.map((cell) => this.escapeCsvCell(cell)).join(','),
    );
    return lines.join('\n');
  }

  private escapeCsvCell(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return '"' + value.replace(/"/g, '""') + '"';
    }
    return value;
  }

  private fmt(value: number): string {
    return isFinite(value) ? value.toFixed(4) : value > 0 ? 'Inf' : '-Inf';
  }

  private pct(value: number): string {
    return isFinite(value) ? value.toFixed(2) : value > 0 ? 'Inf' : '-Inf';
  }
}
