import { IReadonlyMarketData } from '../interfaces/market-data.interface';
import { IReadonlyIndicators } from '../interfaces/indicators.interface';
import { IReadonlyPortfolio } from '../interfaces/portfolio.interface';
import { IReadonlyRiskState } from '../interfaces/risk-state.interface';
import { IHistoricalDataReader } from '../interfaces/historical-data.interface';
import { IExecutionReportsReader } from '../interfaces/execution-reports.interface';

/**
 * SdkStrategyContext is the read-only view of the world delivered to strategies
 * during generateSignal() and optionally during onWarmup().
 *
 * The context is immutable for the duration of one generateSignal() call.
 * After the call returns, the platform rebuilds the context for the next cycle —
 * strategies MUST NOT hold references to the context or its inner objects across
 * hook invocations (they will be stale or recycled).
 *
 * API availability per permission:
 *
 *   marketData      — READ_MARKET_DATA
 *   indicators      — READ_INDICATORS
 *   portfolio       — READ_PORTFOLIO or READ_POSITIONS
 *   riskState       — READ_RISK_STATE
 *   historical      — READ_HISTORICAL_DATA
 *   executionReports— READ_EXECUTION_REPORTS
 *
 * Accessing an API without the corresponding permission throws PermissionDeniedError
 * at runtime. The platform validates permissions at install time to surface this early.
 *
 * symbol and exchange identify the primary market this strategy is running on.
 * timestamp is the UNIX millisecond time of the event that triggered signal generation.
 */
export interface SdkStrategyContext {
  readonly symbol: string;
  readonly exchange: string;
  readonly timestamp: number;

  /** Real-time ticks, trades, order book. Requires READ_MARKET_DATA. */
  readonly marketData: IReadonlyMarketData;

  /** Pre-computed indicator values. Requires READ_INDICATORS. */
  readonly indicators: IReadonlyIndicators;

  /** Portfolio balances, equity, open positions. Requires READ_PORTFOLIO. */
  readonly portfolio: IReadonlyPortfolio;

  /** Risk engine limits and block status. Requires READ_RISK_STATE. */
  readonly riskState: IReadonlyRiskState;

  /**
   * Historical candle reader. Requires READ_HISTORICAL_DATA.
   *
   * getCandles() performs I/O — call it during onWarmup(), not during generateSignal().
   */
  readonly historical: IHistoricalDataReader;

  /** Recent fills and execution reports. Requires READ_EXECUTION_REPORTS. */
  readonly executionReports: IExecutionReportsReader;
}
