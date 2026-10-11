import { SdkPortfolioSnapshot, SdkOpenPosition, SdkAssetBalance } from '../market/position.types';

/**
 * IReadonlyPortfolio provides a read-only view of the account's current financial state.
 *
 * Requires: StrategyPermission.READ_PORTFOLIO
 *
 * All methods are synchronous reads — no I/O occurs.
 *
 * getSnapshot() returns the most recently computed portfolio snapshot. The platform
 * updates snapshots on every fill and on a background heartbeat (configurable interval).
 *
 * getOpenPositions() includes positions opened by ALL strategies, not just the calling
 * strategy. Use this to avoid double-entry into already-held positions.
 *
 * getBalance() returns null when the asset is not held or when balance information
 * is not available for spot accounts that haven't been queried yet.
 */
export interface IReadonlyPortfolio {
  /** Returns the most recent portfolio snapshot. */
  getSnapshot(): SdkPortfolioSnapshot;

  /**
   * Returns all currently open positions across all strategies.
   *
   * Spot accounts always return an empty array (spot has no margin positions).
   * For futures accounts, this includes all open LONG and SHORT positions.
   */
  getOpenPositions(): readonly SdkOpenPosition[];

  /**
   * Returns the balance for a specific asset (e.g. "USDT", "BTC"), or null if unknown.
   *
   * asset is case-sensitive and must match the exchange's asset code exactly.
   */
  getBalance(asset: string): SdkAssetBalance | null;
}
