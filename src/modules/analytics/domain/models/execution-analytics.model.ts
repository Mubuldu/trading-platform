/**
 * ExecutionAnalytics measures the quality of order execution.
 *
 * Slippage is in quote currency (USDT).
 * Latency is in milliseconds.
 * Rates are fractional (e.g. 0.97 = 97%).
 */
export interface ExecutionAnalytics {
  // Slippage statistics (quote currency)
  readonly averageSlippage: number;
  readonly medianSlippage: number;
  readonly worstSlippage: number;
  readonly totalSlippage: number;

  // Latency (milliseconds) — available only when latency data is present
  readonly averageLatencyMs: number;
  readonly medianLatencyMs: number;
  readonly p95LatencyMs: number;
  readonly maxLatencyMs: number;

  // Fill quality rates (fractional, 0–1)
  readonly orderFillRate: number; // filled / total submitted (simulated = 1.0)
  readonly cancelRate: number; // cancelled / total submitted
  readonly partialFillRate: number; // partial fills / total submitted
  readonly rejectedOrderRate: number; // rejected / total submitted

  // Totals
  readonly totalFills: number;
  readonly totalCommission: number;

  readonly computedAt: number;
}
