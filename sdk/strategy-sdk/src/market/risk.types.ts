/**
 * SdkRiskState is a read-only snapshot of the platform risk engine's current limits.
 *
 * Strategies may read this to make self-aware decisions — for example, checking
 * remainingDailyLossUsd before emitting a signal that might not be approved anyway.
 *
 * This is informational only. A strategy cannot modify risk limits.
 *
 * drawdownPercent        — current drawdown from the peak equity as a percentage
 * dailyLossUsd           — total realized + unrealized loss since midnight UTC
 * remainingDailyLossUsd  — how much more loss is allowed before the risk engine blocks all signals
 * openPositionCount      — number of open positions across all strategies
 * signalsBlockedReason   — non-null when the risk engine is actively blocking new signals;
 *                          value is a human-readable reason (e.g. "max drawdown exceeded")
 * snapshotAt             — UNIX millisecond timestamp of this snapshot
 */
export interface SdkRiskState {
  readonly drawdownPercent: number;
  readonly dailyLossUsd: number;
  readonly remainingDailyLossUsd: number;
  readonly openPositionCount: number;
  readonly signalsBlockedReason: string | null;
  readonly snapshotAt: number;
}
