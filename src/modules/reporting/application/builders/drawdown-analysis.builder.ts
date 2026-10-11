import { Injectable } from '@nestjs/common';
import { AnalyticsSnapshot } from '@modules/analytics/domain/models/analytics-snapshot.model';
import { CapitalCurvePoint } from '@modules/analytics/domain/models/capital-metrics.model';
import {
  DrawdownAnalysisSection,
  DrawdownPeriod,
} from '../../domain/models/sections/drawdown-analysis.section';

/**
 * DrawdownAnalysisBuilder computes the drawdown history from the equity curve.
 *
 * Algorithm:
 *   1. Walk the equity curve chronologically.
 *   2. Track the running peak.
 *   3. When equity falls below the peak → begin a drawdown period.
 *   4. When equity recovers to the prior peak → close the period.
 *   5. Collect all closed and any open period.
 */
@Injectable()
export class DrawdownAnalysisBuilder {
  private static readonly TOP_N = 5;

  build(snapshot: AnalyticsSnapshot): DrawdownAnalysisSection {
    const curve = snapshot.capitalMetrics.equityCurve;
    const r = snapshot.riskMetrics;

    if (curve.length === 0) {
      return this.empty(r);
    }

    const periods = this.extractDrawdownPeriods(curve);
    const top5 = this.rankAndSlice(periods);
    const current = this.currentDrawdown(curve, r);

    const averageRecoveryMs = this.avgRecovery(periods);
    const longestDrawdownMs =
      periods.length > 0 ? Math.max(...periods.map((p) => p.durationMs)) : 0;

    return {
      isInDrawdown: current.isIn,
      currentDrawdownPercent: current.pct * 100,
      currentDrawdownAbsolute: current.abs,
      drawdownStartDate: current.startDate,

      maxDrawdownPercent: r.maxDrawdown * 100,
      maxDrawdownAbsolute: r.maxDrawdownAbsolute,
      averageDrawdownPercent: r.averageDrawdown * 100,
      ulcerIndex: r.ulcerIndex,
      painIndex: r.painIndex,

      averageRecoveryMs,
      longestDrawdownMs,
      totalDrawdownPeriods: periods.length,
      top5Drawdowns: top5,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private extractDrawdownPeriods(curve: readonly CapitalCurvePoint[]): DrawdownPeriod[] {
    const periods: DrawdownPeriod[] = [];
    let peakEquity = curve[0]!.equity;
    let peakDate = curve[0]!.date;
    let inDrawdown = false;
    let troughEquity = peakEquity;
    let troughDate = peakDate;

    for (const point of curve) {
      if (point.equity >= peakEquity) {
        // Recovery or new high
        if (inDrawdown) {
          // Close the drawdown period
          const depthAbsolute = peakEquity - troughEquity;
          const depthPercent = peakEquity > 0 ? depthAbsolute / peakEquity : 0;
          const durationMs = new Date(troughDate).getTime() - new Date(peakDate).getTime();
          const recoveryMs = new Date(point.date).getTime() - new Date(troughDate).getTime();

          periods.push({
            rank: 0, // assigned in rankAndSlice
            startDate: peakDate,
            troughDate,
            endDate: point.date,
            depthPercent,
            depthAbsolute,
            equityAtPeak: peakEquity,
            equityAtTrough: troughEquity,
            durationMs: Math.max(0, durationMs),
            recoveryMs: Math.max(0, recoveryMs),
          });
          inDrawdown = false;
        }

        peakEquity = point.equity;
        peakDate = point.date;
        troughEquity = point.equity;
        troughDate = point.date;
      } else {
        // Below peak
        inDrawdown = true;
        if (point.equity < troughEquity) {
          troughEquity = point.equity;
          troughDate = point.date;
        }
      }
    }

    // Close any open drawdown at the end of the series
    if (inDrawdown && peakEquity > troughEquity) {
      const depthAbsolute = peakEquity - troughEquity;
      const depthPercent = peakEquity > 0 ? depthAbsolute / peakEquity : 0;
      const durationMs = new Date(troughDate).getTime() - new Date(peakDate).getTime();

      periods.push({
        rank: 0,
        startDate: peakDate,
        troughDate,
        endDate: null, // still in drawdown
        depthPercent,
        depthAbsolute,
        equityAtPeak: peakEquity,
        equityAtTrough: troughEquity,
        durationMs: Math.max(0, durationMs),
        recoveryMs: null,
      });
    }

    return periods;
  }

  private rankAndSlice(periods: DrawdownPeriod[]): DrawdownPeriod[] {
    return periods
      .sort((a, b) => b.depthPercent - a.depthPercent)
      .slice(0, DrawdownAnalysisBuilder.TOP_N)
      .map((p, i) => ({ ...p, rank: i + 1 }));
  }

  private currentDrawdown(
    curve: readonly CapitalCurvePoint[],
    r: AnalyticsSnapshot['riskMetrics'],
  ): { isIn: boolean; pct: number; abs: number; startDate: string | null } {
    const last = curve[curve.length - 1];
    if (!last) return { isIn: false, pct: 0, abs: 0, startDate: null };

    const isIn = last.drawdownPercent > 0.001; // small epsilon
    if (!isIn) return { isIn: false, pct: 0, abs: 0, startDate: null };

    // Walk backwards to find when drawdown started
    let startDate: string | null = last.date;
    for (let i = curve.length - 2; i >= 0; i--) {
      const pt = curve[i]!;
      if (pt.drawdownPercent < 0.001) {
        startDate = curve[i + 1]?.date ?? last.date;
        break;
      }
      if (i === 0) startDate = pt.date;
    }

    return {
      isIn: true,
      pct: last.drawdownPercent,
      abs:
        r.maxDrawdownAbsolute > 0
          ? (last.drawdownPercent * r.maxDrawdownAbsolute) / r.maxDrawdown
          : 0,
      startDate,
    };
  }

  private avgRecovery(periods: DrawdownPeriod[]): number {
    const recovered = periods.filter((p) => p.recoveryMs !== null);
    if (recovered.length === 0) return 0;
    const total = recovered.reduce((sum, p) => sum + (p.recoveryMs ?? 0), 0);
    return total / recovered.length;
  }

  private empty(r: AnalyticsSnapshot['riskMetrics']): DrawdownAnalysisSection {
    return {
      isInDrawdown: false,
      currentDrawdownPercent: 0,
      currentDrawdownAbsolute: 0,
      drawdownStartDate: null,
      maxDrawdownPercent: r.maxDrawdown * 100,
      maxDrawdownAbsolute: r.maxDrawdownAbsolute,
      averageDrawdownPercent: r.averageDrawdown * 100,
      ulcerIndex: r.ulcerIndex,
      painIndex: r.painIndex,
      averageRecoveryMs: 0,
      longestDrawdownMs: 0,
      totalDrawdownPeriods: 0,
      top5Drawdowns: [],
    };
  }
}
