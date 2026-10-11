import { SdkRiskState } from '../market/risk.types';

/**
 * IReadonlyRiskState provides a read-only view of the risk engine's current state.
 *
 * Requires: StrategyPermission.READ_RISK_STATE
 *
 * Strategies can use this to make self-aware decisions — for example:
 *   - Suppressing signals when they know the risk engine will reject them anyway
 *   - Reducing position size suggestions based on remaining daily loss allowance
 *   - Avoiding entry when near maximum drawdown thresholds
 *
 * Reading risk state does NOT influence the risk engine — it is informational only.
 * The risk engine independently evaluates every signal regardless of what strategies read.
 *
 * All methods are synchronous reads of in-memory snapshots.
 */
export interface IReadonlyRiskState {
  /** Returns the most recent risk engine snapshot. */
  getRiskState(): SdkRiskState;

  /**
   * Returns true when the risk engine is currently blocking all new signals.
   *
   * A blocked state means any signal emitted will be immediately rejected.
   * Strategies may skip signal generation entirely when this returns true.
   * Reasons include: max drawdown hit, daily loss limit reached, circuit breaker open.
   */
  isSignalBlocked(): boolean;

  /**
   * Returns the remaining USD loss budget for today (midnight UTC rollover).
   *
   * Returns 0.0 when the daily loss limit has been fully consumed.
   * Returns Infinity when no daily loss limit is configured.
   */
  getRemainingDailyLossUsd(): number;
}
