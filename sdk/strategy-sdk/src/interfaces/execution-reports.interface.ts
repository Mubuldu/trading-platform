import { SdkExecutionReport } from '../market/execution.types';

/**
 * IExecutionReportsReader provides read-only access to recent execution reports.
 *
 * Requires: StrategyPermission.READ_EXECUTION_REPORTS
 *
 * Execution reports are delivered to strategies via lifecycle hooks:
 *   - onOrderFilled()   — triggered by the platform when a fill arrives
 *   - onOrderRejected() — triggered when an order is rejected or cancelled
 *
 * This interface provides programmatic access to the same data, useful for
 * building internal state during onWarmup() or for multi-candle lookbacks in
 * generateSignal().
 *
 * All methods are synchronous reads of an in-memory ring buffer. The platform
 * retains the most recent N fills per symbol (platform-configured, typically 100).
 */
export interface IExecutionReportsReader {
  /**
   * Returns recent execution reports for the given symbol, newest first.
   *
   * limit defaults to 10. Maximum is 100 (platform-enforced ceiling).
   * Returns an empty array when no fills have been recorded for the symbol.
   */
  getRecentFills(symbol: string, limit?: number): readonly SdkExecutionReport[];

  /**
   * Returns the most recent execution report for the given symbol, or null.
   *
   * Equivalent to getRecentFills(symbol, 1)[0] ?? null but slightly faster.
   */
  getLastFill(symbol: string): SdkExecutionReport | null;
}
