import { Injectable } from '@nestjs/common';
import { AnalyticsSnapshot } from '@modules/analytics/domain/models/analytics-snapshot.model';
import { ExecutionQualitySection } from '../../domain/models/sections/execution-quality.section';

/**
 * ExecutionQualityBuilder assembles execution analytics and derives a
 * composite execution score (0–100).
 *
 * Score formula:
 *   fillScore      = orderFillRate × 40
 *   slippageScore  = max(0, 1 - slippageRatio) × 30
 *                    where slippageRatio = |totalSlippage| / max(|netProfit|, 1)
 *   latencyScore   = max(0, 1 - log10(avgLatencyMs + 1) / 4) × 30
 *                    (100ms → ~0.75; 1000ms → ~0.25; 10000ms → ~0)
 *   executionScore = fillScore + slippageScore + latencyScore
 */
@Injectable()
export class ExecutionQualityBuilder {
  build(snapshot: AnalyticsSnapshot): ExecutionQualitySection {
    const { executionAnalytics: ex, performance: p } = snapshot;

    const netPnlAbs = Math.abs(p.netProfit);
    const slippageAsPercentOfPnl =
      netPnlAbs > 0
        ? ex.totalSlippage / netPnlAbs
        : Number.isFinite(ex.totalSlippage)
          ? ex.totalSlippage
          : NaN;

    const commissionAsPercentOfPnl =
      netPnlAbs > 0
        ? ex.totalCommission / netPnlAbs
        : Number.isFinite(ex.totalCommission)
          ? ex.totalCommission
          : NaN;

    const executionScore = this.computeScore(
      ex.orderFillRate,
      ex.totalSlippage,
      netPnlAbs,
      ex.averageLatencyMs,
    );

    return {
      averageSlippage: ex.averageSlippage,
      medianSlippage: ex.medianSlippage,
      worstSlippage: ex.worstSlippage,
      totalSlippage: ex.totalSlippage,
      slippageAsPercentOfPnl,

      averageLatencyMs: ex.averageLatencyMs,
      medianLatencyMs: ex.medianLatencyMs,
      p95LatencyMs: ex.p95LatencyMs,
      maxLatencyMs: ex.maxLatencyMs,

      orderFillRate: ex.orderFillRate,
      cancelRate: ex.cancelRate,
      partialFillRate: ex.partialFillRate,
      rejectedOrderRate: ex.rejectedOrderRate,

      totalFills: ex.totalFills,
      totalCommission: ex.totalCommission,
      commissionAsPercentOfPnl,

      executionScore,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private computeScore(
    fillRate: number,
    totalSlippage: number,
    netPnlAbs: number,
    avgLatencyMs: number,
  ): number {
    // Fill quality (0–40)
    const fillScore = Math.min(1, Math.max(0, fillRate)) * 40;

    // Slippage relative to PnL (0–30)
    const slippageRatio = netPnlAbs > 0 ? Math.abs(totalSlippage) / netPnlAbs : 0;
    const slippageScore = Math.max(0, 1 - slippageRatio) * 30;

    // Latency (0–30): log10 scale; 1ms=30, 100ms≈22, 1000ms≈15, 10000ms≈7.5
    const latencyScore =
      avgLatencyMs <= 0 ? 30 : Math.max(0, 1 - Math.log10(avgLatencyMs + 1) / 5) * 30;

    return Math.round(Math.min(100, fillScore + slippageScore + latencyScore));
  }
}
