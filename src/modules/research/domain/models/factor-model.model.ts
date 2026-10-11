/**
 * Factor models decompose asset returns into exposures to systematic factors,
 * isolating alpha (idiosyncratic return) from beta (factor-driven return).
 */

// ─── Factor Definitions ───────────────────────────────────────────────────────

export enum FactorType {
  /** Sensitivity to the broad market return (CAPM beta). */
  MARKET = 'MARKET',
  /** Short-term price continuation (e.g. 1-month momentum). */
  MOMENTUM_SHORT = 'MOMENTUM_SHORT',
  /** Medium-term price continuation (e.g. 3–12 month momentum). */
  MOMENTUM_MEDIUM = 'MOMENTUM_MEDIUM',
  /** Mean-reversion tendency over short horizons. */
  MEAN_REVERSION = 'MEAN_REVERSION',
  /** Sensitivity to realised volatility shocks. */
  VOLATILITY = 'VOLATILITY',
  /** Sensitivity to volume-driven liquidity. */
  LIQUIDITY = 'LIQUIDITY',
  /** Carry / funding rate sensitivity (crypto-specific). */
  FUNDING_CARRY = 'FUNDING_CARRY',
  /** Open interest growth sensitivity. */
  OPEN_INTEREST = 'OPEN_INTEREST',
}

export interface FactorDefinition {
  readonly type: FactorType;
  /** Lookback window in bars used to compute the factor. */
  readonly lookbackBars: number;
  /** Human-readable description. */
  readonly description: string;
}

// ─── Factor Exposure ─────────────────────────────────────────────────────────

export interface FactorExposure {
  readonly factor: FactorType;
  /** OLS regression coefficient (beta) of asset returns on factor returns. */
  readonly beta: number;
  /** Standard error of the beta estimate. */
  readonly betaStdErr: number;
  /** t-statistic for beta significance (H₀: beta = 0). */
  readonly tStat: number;
  /** R² of the single-factor regression. */
  readonly rSquared: number;
}

// ─── Factor Model Result ─────────────────────────────────────────────────────

export interface FactorModelResult {
  readonly experimentId: string;
  readonly symbol: string;
  readonly timeframe: string;
  readonly periodStartMs: number;
  readonly periodEndMs: number;

  /** Per-factor exposures from full OLS regression. */
  readonly exposures: FactorExposure[];

  /** Explained variance from the multi-factor model (full R²). */
  readonly totalRSquared: number;

  /**
   * Annualised alpha: return unexplained by the factors.
   * Positive alpha indicates genuine edge beyond systematic factor exposure.
   */
  readonly annualizedAlpha: number;

  /** Idiosyncratic (unexplained) return series aligned to analysis bars. */
  readonly residuals: number[];

  readonly computedAt: Date;
}
