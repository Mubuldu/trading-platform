/**
 * ExecutionQualitySection — order execution performance statistics.
 *
 * executionScore — composite 0–100 quality score derived from:
 *   fill rate (40%), slippage vs expectancy ratio (30%), latency (30%).
 *   100 = perfect fills, zero slippage, sub-millisecond latency.
 */
export interface ExecutionQualitySection {
  // Slippage (quote currency)
  readonly averageSlippage: number;
  readonly medianSlippage: number;
  readonly worstSlippage: number;
  readonly totalSlippage: number;
  readonly slippageAsPercentOfPnl: number; // totalSlippage / |netProfit|, NaN when netProfit=0

  // Latency (milliseconds)
  readonly averageLatencyMs: number;
  readonly medianLatencyMs: number;
  readonly p95LatencyMs: number;
  readonly maxLatencyMs: number;

  // Fill quality rates (fractional 0–1)
  readonly orderFillRate: number;
  readonly cancelRate: number;
  readonly partialFillRate: number;
  readonly rejectedOrderRate: number;

  // Totals
  readonly totalFills: number;
  readonly totalCommission: number;
  readonly commissionAsPercentOfPnl: number; // NaN when netProfit=0

  // Composite score
  readonly executionScore: number; // 0–100
}
