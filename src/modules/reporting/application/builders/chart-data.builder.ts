import { Injectable } from '@nestjs/common';
import { AnalyticsSnapshot } from '@modules/analytics/domain/models/analytics-snapshot.model';
import { CapitalCurvePoint } from '@modules/analytics/domain/models/capital-metrics.model';
import { AnalyticsTrade } from '@modules/analytics/domain/models/analytics-trade.model';
import {
  ReportChartPoint,
  MonthlyReturnPoint,
  DistributionBucket,
  ReportCharts,
} from '../../domain/models/charts/report-charts.model';

/**
 * ChartDataBuilder extracts and transforms analytics data into the
 * chart-ready data structures required by TradingReport.charts.
 *
 * No rendering is performed here — callers receive raw number series.
 */
@Injectable()
export class ChartDataBuilder {
  private static readonly PNL_BUCKETS = 20;
  private static readonly HOLDING_BUCKETS = 10;

  build(snapshot: AnalyticsSnapshot, trades: AnalyticsTrade[]): ReportCharts {
    return {
      equityCurve: this.buildEquityCurve(snapshot.capitalMetrics.equityCurve),
      balanceCurve: this.buildBalanceCurve(snapshot.capitalMetrics.balanceCurve),
      drawdownCurve: this.buildDrawdownCurve(snapshot.capitalMetrics.equityCurve),
      rollingSharpe: this.buildRollingSharpe(snapshot),
      rollingVolatility: this.buildRollingVolatility(snapshot),
      monthlyReturns: this.buildMonthlyReturns(snapshot.capitalMetrics.equityCurve),
      tradeDistribution: this.buildTradeDistribution(trades),
      pnlDistribution: this.buildPnlDistribution(snapshot.capitalMetrics.equityCurve),
      holdingTimeDistribution: this.buildHoldingTimeDistribution(trades),
    };
  }

  // ── Curve builders ─────────────────────────────────────────────────────────

  private buildEquityCurve(curve: readonly CapitalCurvePoint[]): ReportChartPoint[] {
    return curve.map((p) => ({ timestamp: p.timestamp, date: p.date, value: p.equity }));
  }

  private buildBalanceCurve(curve: readonly CapitalCurvePoint[]): ReportChartPoint[] {
    return curve.map((p) => ({ timestamp: p.timestamp, date: p.date, value: p.cashBalance }));
  }

  private buildDrawdownCurve(curve: readonly CapitalCurvePoint[]): ReportChartPoint[] {
    return curve.map((p) => ({
      timestamp: p.timestamp,
      date: p.date,
      value: -(p.drawdownPercent * 100), // negative = drawdown below zero (visual convention)
    }));
  }

  /**
   * Rolling 30-day Sharpe series.
   * We approximate daily Sharpe by computing from the rolling window's data.
   * One point is emitted per daily equity-curve entry.
   */
  private buildRollingSharpe(snapshot: AnalyticsSnapshot): ReportChartPoint[] {
    const curve = snapshot.capitalMetrics.equityCurve;
    const WINDOW = 30;
    const result: ReportChartPoint[] = [];

    const returns = this.dailyReturns(curve);

    for (let i = 0; i < returns.length; i++) {
      const slice = returns.slice(Math.max(0, i - WINDOW + 1), i + 1);
      const sharpe = this.rollingSharpeFast(slice);
      const pt = curve[i + 1]; // returns[i] corresponds to curve[i+1]
      if (pt) {
        result.push({ timestamp: pt.timestamp, date: pt.date, value: sharpe });
      }
    }

    return result;
  }

  /**
   * Rolling 30-day annualised volatility series.
   */
  private buildRollingVolatility(snapshot: AnalyticsSnapshot): ReportChartPoint[] {
    const curve = snapshot.capitalMetrics.equityCurve;
    const WINDOW = 30;
    const result: ReportChartPoint[] = [];

    const returns = this.dailyReturns(curve);

    for (let i = 0; i < returns.length; i++) {
      const slice = returns.slice(Math.max(0, i - WINDOW + 1), i + 1);
      const vol = this.stdDev(slice) * Math.sqrt(252) * 100; // annualised %
      const pt = curve[i + 1];
      if (pt) {
        result.push({ timestamp: pt.timestamp, date: pt.date, value: vol });
      }
    }

    return result;
  }

  // ── Monthly returns heatmap ─────────────────────────────────────────────────

  private buildMonthlyReturns(curve: readonly CapitalCurvePoint[]): MonthlyReturnPoint[] {
    if (curve.length < 2) return [];

    // Group daily data by year-month and compute monthly return
    const monthMap = new Map<string, { start: number; end: number }>();

    for (const point of curve) {
      const ym = point.date.substring(0, 7); // "YYYY-MM"
      const existing = monthMap.get(ym);
      if (!existing) {
        monthMap.set(ym, { start: point.equity, end: point.equity });
      } else {
        existing.end = point.equity;
      }
    }

    const results: MonthlyReturnPoint[] = [];
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];

    for (const [ym, { start, end }] of monthMap.entries()) {
      const [yearStr, monthStr] = ym.split('-');
      const year = Number(yearStr);
      const month = Number(monthStr);
      const returnPercent = start > 0 ? ((end - start) / start) * 100 : 0;

      results.push({
        year,
        month,
        label: `${months[month - 1]} ${year}`,
        returnPercent,
        isProfit: returnPercent >= 0,
      });
    }

    return results.sort((a, b) => (a.year !== b.year ? a.year - b.year : a.month - b.month));
  }

  // ── Distribution builders ──────────────────────────────────────────────────

  /**
   * Histogram of per-trade PnL amounts.
   */
  private buildTradeDistribution(trades: AnalyticsTrade[]): DistributionBucket[] {
    if (trades.length === 0) return [];

    const pnls = trades.map((t) => t.netPnl);
    return this.histogram(pnls, ChartDataBuilder.PNL_BUCKETS);
  }

  /**
   * Histogram of daily PnL changes (equity-curve based).
   */
  private buildPnlDistribution(curve: readonly CapitalCurvePoint[]): DistributionBucket[] {
    if (curve.length < 2) return [];

    const dailyPnls: number[] = [];
    for (let i = 1; i < curve.length; i++) {
      dailyPnls.push(curve[i]!.equity - curve[i - 1]!.equity);
    }
    return this.histogram(dailyPnls, ChartDataBuilder.PNL_BUCKETS);
  }

  /**
   * Histogram of trade holding times (milliseconds).
   */
  private buildHoldingTimeDistribution(trades: AnalyticsTrade[]): DistributionBucket[] {
    if (trades.length === 0) return [];

    const holdingTimes = trades.map((t) => t.exitTime - t.entryTime);
    const bucketed = this.histogram(holdingTimes, ChartDataBuilder.HOLDING_BUCKETS);

    // Convert ms labels to human-readable duration strings
    return bucketed.map((b) => ({
      ...b,
      label: `${this.formatDurationMs(b.rangeMin)}–${this.formatDurationMs(b.rangeMax)}`,
    }));
  }

  // ── Math helpers ────────────────────────────────────────────────────────────

  private dailyReturns(curve: readonly CapitalCurvePoint[]): number[] {
    const result: number[] = [];
    for (let i = 1; i < curve.length; i++) {
      const prev = curve[i - 1]!.equity;
      result.push(prev > 0 ? (curve[i]!.equity - prev) / prev : 0);
    }
    return result;
  }

  private rollingSharpeFast(returns: number[]): number {
    if (returns.length < 2) return 0;
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const std = this.stdDev(returns);
    return std > 0 ? (mean / std) * Math.sqrt(252) : 0;
  }

  private stdDev(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
    return Math.sqrt(variance);
  }

  private histogram(values: number[], buckets: number): DistributionBucket[] {
    if (values.length === 0) return [];

    const min = Math.min(...values);
    const max = Math.max(...values);

    if (min === max) {
      return [
        {
          label: `${min.toFixed(2)}`,
          rangeMin: min,
          rangeMax: max,
          count: values.length,
          frequency: 1,
        },
      ];
    }

    const bucketSize = (max - min) / buckets;
    const counts = new Array<number>(buckets).fill(0);

    for (const v of values) {
      const idx = Math.min(buckets - 1, Math.floor((v - min) / bucketSize));
      counts[idx]!++;
    }

    return counts.map((count, i) => {
      const rangeMin = min + i * bucketSize;
      const rangeMax = rangeMin + bucketSize;
      return {
        label: `[${rangeMin.toFixed(2)}, ${rangeMax.toFixed(2)})`,
        rangeMin,
        rangeMax,
        count,
        frequency: values.length > 0 ? count / values.length : 0,
      };
    });
  }

  private formatDurationMs(ms: number): string {
    const s = ms / 1000;
    if (s < 60) return `${Math.round(s)}s`;
    if (s < 3_600) return `${Math.round(s / 60)}m`;
    if (s < 86_400) return `${Math.round(s / 3_600)}h`;
    return `${Math.round(s / 86_400)}d`;
  }
}
