import { Injectable } from '@nestjs/common';
import { AnalyticsFill } from '../../domain/models/analytics-trade.model';
import { ExecutionAnalytics } from '../../domain/models/execution-analytics.model';

/**
 * ExecutionAnalyticsCalculator measures order execution quality from fill records.
 *
 * Slippage values are in quote currency (USDT).
 * Latency values are in milliseconds.
 * Rate values are fractional (0–1).
 *
 * In paper trading mode, fill rates reflect the simulator's behaviour:
 *   orderFillRate  = 1.0 (paper fills always succeed)
 *   cancelRate     = 0.0
 *   partialFillRate= depends on simulator config
 *   rejectedRate   = 0.0
 *
 * These defaults are overridden when real order-lifecycle data is provided
 * via the `totalSubmitted`, `totalCancelled`, `totalRejected` parameters.
 */
@Injectable()
export class ExecutionAnalyticsCalculator {
  compute(
    fills: AnalyticsFill[],
    options: {
      totalSubmitted?: number;
      totalCancelled?: number;
      totalRejected?: number;
      totalPartial?: number;
    } = {},
  ): ExecutionAnalytics {
    const totalFills = fills.length;

    if (totalFills === 0) {
      return this.empty();
    }

    // Slippage
    const slippages = fills.map((f) => f.slippage);
    const averageSlippage = this.mean(slippages);
    const medianSlippage = this.median(slippages);
    const worstSlippage = Math.max(...slippages);
    const totalSlippage = slippages.reduce((s, v) => s + v, 0);

    // Latency — only present on fills that include it
    const latencies = fills
      .map((f) => f.latencyMs)
      .filter((v): v is number => v !== undefined && v >= 0);

    const averageLatencyMs = latencies.length > 0 ? this.mean(latencies) : 0;
    const medianLatencyMs = latencies.length > 0 ? this.median(latencies) : 0;
    const maxLatencyMs = latencies.length > 0 ? Math.max(...latencies) : 0;
    const p95LatencyMs = latencies.length > 0 ? this.percentile(latencies, 0.95) : 0;

    // Commission
    const totalCommission = fills.reduce((s, f) => s + f.commission, 0);

    // Fill quality rates
    const submitted = options.totalSubmitted ?? totalFills;
    const cancelled = options.totalCancelled ?? 0;
    const rejected = options.totalRejected ?? 0;
    const partial = options.totalPartial ?? 0;

    const orderFillRate = submitted > 0 ? totalFills / submitted : 1;
    const cancelRate = submitted > 0 ? cancelled / submitted : 0;
    const rejectedOrderRate = submitted > 0 ? rejected / submitted : 0;
    const partialFillRate = submitted > 0 ? partial / submitted : 0;

    return {
      averageSlippage,
      medianSlippage,
      worstSlippage,
      totalSlippage,
      averageLatencyMs,
      medianLatencyMs,
      p95LatencyMs,
      maxLatencyMs,
      orderFillRate,
      cancelRate,
      partialFillRate,
      rejectedOrderRate,
      totalFills,
      totalCommission,
      computedAt: Date.now(),
    };
  }

  // ── Math helpers ─────────────────────────────────────────────────────────────

  private mean(values: number[]): number {
    return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;
  }

  private median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  }

  private percentile(sortedValues: number[], p: number): number {
    const sorted = [...sortedValues].sort((a, b) => a - b);
    const idx = Math.ceil(p * sorted.length) - 1;
    return sorted[Math.max(0, idx)] ?? 0;
  }

  private empty(): ExecutionAnalytics {
    return {
      averageSlippage: 0,
      medianSlippage: 0,
      worstSlippage: 0,
      totalSlippage: 0,
      averageLatencyMs: 0,
      medianLatencyMs: 0,
      p95LatencyMs: 0,
      maxLatencyMs: 0,
      orderFillRate: 1,
      cancelRate: 0,
      partialFillRate: 0,
      rejectedOrderRate: 0,
      totalFills: 0,
      totalCommission: 0,
      computedAt: Date.now(),
    };
  }
}
