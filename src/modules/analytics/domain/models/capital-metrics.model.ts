/**
 * CapitalMetrics describes the evolution of capital over time.
 *
 * equityCurve   — time-series of total account equity
 * balanceCurve  — time-series of cash balance (excluding unrealized PnL)
 * All monetary values are in quote currency (USDT).
 * Utilisation values are fractional (0–1).
 */
export interface CapitalCurvePoint {
  readonly date: string; // YYYY-MM-DD
  readonly timestamp: number; // unix ms (start of day)
  readonly equity: number;
  readonly cashBalance: number;
  readonly unrealizedPnl: number;
  readonly dailyReturn: number; // fractional
  readonly cumulativeReturn: number; // fractional from period start
  readonly drawdownPercent: number; // fractional from peak (positive = drawdown)
}

export interface CapitalMetrics {
  // Curves (chronological, one entry per trading day)
  readonly equityCurve: CapitalCurvePoint[];
  readonly balanceCurve: CapitalCurvePoint[];

  // Current snapshot
  readonly currentEquity: number;
  readonly currentBalance: number;
  readonly buyingPower: number;

  // Margin & leverage
  readonly marginUsed: number; // USDT locked as margin
  readonly marginUtilizationPercent: number; // marginUsed / currentEquity
  readonly leverageUtilization: number; // grossExposure / currentEquity

  // Cash utilisation
  readonly cashUtilizationPercent: number; // (equity - balance) / equity

  readonly snapshotAt: number;
}
