import { Injectable } from '@nestjs/common';
import { AnalyticsEquityPoint, AnalyticsTrade } from '../../domain/models/analytics-trade.model';
import { RollingMetrics, RollingWindowMetrics } from '../../domain/models/rolling-metrics.model';
import { RollingWindow, ALL_ROLLING_WINDOWS } from '../../domain/enums/rolling-window.enum';

const MS_PER_DAY = 86_400_000;
const RISK_FREE_DAILY = 0.05 / 252;
const TRADING_DAYS_PER_YEAR = 252;

/**
 * RollingMetricsCalculator computes all performance metrics for each of the
 * five defined rolling windows (7, 30, 90, 180, 365 days).
 *
 * For each window the calculator:
 *   1. Slices equityPoints to the look-back period
 *   2. Slices trades to the same period
 *   3. Recomputes all metrics using only the window data
 *
 * Windows with insufficient data return 0 for ratio fields.
 */
@Injectable()
export class RollingMetricsCalculator {
  compute(equityPoints: AnalyticsEquityPoint[], trades: AnalyticsTrade[]): RollingMetrics {
    const now =
      equityPoints.length > 0 ? equityPoints[equityPoints.length - 1]!.timestamp : Date.now();

    const computedAt = Date.now();

    const compute = (w: RollingWindow): RollingWindowMetrics =>
      this.computeWindow(equityPoints, trades, w, now);

    return {
      sevenDay: compute(RollingWindow.SEVEN_DAYS),
      thirtyDay: compute(RollingWindow.THIRTY_DAYS),
      ninetyDay: compute(RollingWindow.NINETY_DAYS),
      oneEightyDay: compute(RollingWindow.ONE_EIGHTY_DAYS),
      threeSixtyFiveDay: compute(RollingWindow.THREE_SIXTY_FIVE_DAYS),
      computedAt,
    };
  }

  computeForWindows(
    equityPoints: AnalyticsEquityPoint[],
    trades: AnalyticsTrade[],
    windows: RollingWindow[],
  ): RollingWindowMetrics[] {
    const now =
      equityPoints.length > 0 ? equityPoints[equityPoints.length - 1]!.timestamp : Date.now();
    return windows.map((w) => this.computeWindow(equityPoints, trades, w, now));
  }

  // ── Window computation ───────────────────────────────────────────────────────

  private computeWindow(
    equityPoints: AnalyticsEquityPoint[],
    trades: AnalyticsTrade[],
    window: RollingWindow,
    nowMs: number,
  ): RollingWindowMetrics {
    const cutoffMs = nowMs - window * MS_PER_DAY;

    const windowPoints = equityPoints.filter((p) => p.timestamp >= cutoffMs);
    const windowTrades = trades.filter((t) => t.exitTime >= cutoffMs);

    const startDate = windowPoints.length > 0 ? windowPoints[0]!.date : '';
    const endDate = windowPoints.length > 0 ? windowPoints[windowPoints.length - 1]!.date : '';

    const dailyReturns = windowPoints.map((p) => p.dailyReturn);

    const totalReturnPercent = this.totalReturn(windowPoints);
    const annualizedReturnPercent = this.annualizedReturn(windowPoints, window);
    const sharpeRatio = this.sharpe(dailyReturns);
    const sortinoRatio = this.sortino(dailyReturns);

    const drawdownSeries = this.drawdownSeries(windowPoints);
    const maxDrawdown = drawdownSeries.length > 0 ? Math.max(...drawdownSeries, 0) : 0;
    const averageDrawdown = this.mean(drawdownSeries);

    const calmarRatio = maxDrawdown > 0 ? annualizedReturnPercent / (maxDrawdown * 100) : 0;

    // Trade stats
    const winners = windowTrades.filter((t) => t.netPnl > 0);
    const losers = windowTrades.filter((t) => t.netPnl < 0);
    const winRate = windowTrades.length > 0 ? winners.length / windowTrades.length : 0;
    const grossProfit = winners.reduce((s, t) => s + t.netPnl, 0);
    const grossLoss = Math.abs(losers.reduce((s, t) => s + t.netPnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
    const netProfit = windowTrades.reduce((s, t) => s + t.netPnl, 0);

    // Volatility
    const dailyVolatility = this.std(dailyReturns);
    const annualizedVolatility = dailyVolatility * Math.sqrt(TRADING_DAYS_PER_YEAR);

    return {
      window,
      windowDays: window,
      startDate,
      endDate,
      totalReturnPercent,
      annualizedReturnPercent,
      sharpeRatio,
      sortinoRatio,
      calmarRatio,
      maxDrawdown,
      averageDrawdown,
      totalTrades: windowTrades.length,
      winRate,
      profitFactor,
      netProfit,
      dailyVolatility,
      annualizedVolatility,
      computedAt: Date.now(),
    };
  }

  // ── Math helpers ─────────────────────────────────────────────────────────────

  private totalReturn(points: AnalyticsEquityPoint[]): number {
    if (points.length < 2) return 0;
    const first = points[0]!.equity;
    const last = points[points.length - 1]!.equity;
    return first > 0 ? ((last - first) / first) * 100 : 0;
  }

  private annualizedReturn(points: AnalyticsEquityPoint[], windowDays: number): number {
    if (points.length < 2) return 0;
    const first = points[0]!.equity;
    const last = points[points.length - 1]!.equity;
    if (first <= 0) return 0;
    const yearsElapsed = windowDays / TRADING_DAYS_PER_YEAR;
    return (Math.pow(last / first, 1 / yearsElapsed) - 1) * 100;
  }

  private drawdownSeries(points: AnalyticsEquityPoint[]): number[] {
    let peak = 0;
    return points.map((p) => {
      if (p.equity > peak) peak = p.equity;
      return peak > 0 ? (peak - p.equity) / peak : 0;
    });
  }

  private sharpe(dailyReturns: number[]): number {
    if (dailyReturns.length < 2) return 0;
    const m = this.mean(dailyReturns);
    const excessMean = m - RISK_FREE_DAILY;
    const s = this.std(dailyReturns);
    return s === 0 ? 0 : (excessMean / s) * Math.sqrt(TRADING_DAYS_PER_YEAR);
  }

  private sortino(dailyReturns: number[]): number {
    if (dailyReturns.length < 2) return 0;
    const m = this.mean(dailyReturns);
    const excessMean = m - RISK_FREE_DAILY;
    const downsideVar =
      dailyReturns.reduce((s, r) => {
        const diff = Math.min(r - RISK_FREE_DAILY, 0);
        return s + diff * diff;
      }, 0) / dailyReturns.length;
    const downsideStd = Math.sqrt(downsideVar);
    return downsideStd === 0 ? 0 : (excessMean / downsideStd) * Math.sqrt(TRADING_DAYS_PER_YEAR);
  }

  private mean(values: number[]): number {
    return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;
  }

  private variance(values: number[]): number {
    if (values.length < 2) return 0;
    const m = this.mean(values);
    return values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
  }

  private std(values: number[]): number {
    return Math.sqrt(this.variance(values));
  }
}

export { ALL_ROLLING_WINDOWS };
