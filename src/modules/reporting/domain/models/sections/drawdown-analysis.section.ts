/**
 * DrawdownPeriod describes a single peak-to-trough drawdown event.
 *
 * startDate   — date of the equity peak that begins the drawdown
 * troughDate  — date of the lowest equity point during the drawdown
 * endDate     — date of full recovery to previous peak; null = still in drawdown
 * recoveryMs  — null when endDate is null
 */
export interface DrawdownPeriod {
  readonly rank: number; // 1 = deepest
  readonly startDate: string; // YYYY-MM-DD
  readonly troughDate: string; // YYYY-MM-DD
  readonly endDate: string | null; // YYYY-MM-DD, null = not yet recovered
  readonly depthPercent: number; // fractional depth (e.g. 0.15 = 15%)
  readonly depthAbsolute: number; // quote-currency depth
  readonly equityAtPeak: number;
  readonly equityAtTrough: number;
  readonly durationMs: number; // peak to trough
  readonly recoveryMs: number | null; // trough to full recovery, null = ongoing
}

/**
 * DrawdownAnalysisSection — full drawdown history and statistics.
 */
export interface DrawdownAnalysisSection {
  // Current state
  readonly isInDrawdown: boolean;
  readonly currentDrawdownPercent: number; // 0 when not in drawdown
  readonly currentDrawdownAbsolute: number;
  readonly drawdownStartDate: string | null; // null when not in drawdown

  // All-time extremes
  readonly maxDrawdownPercent: number;
  readonly maxDrawdownAbsolute: number;
  readonly averageDrawdownPercent: number;

  // Pain metrics
  readonly ulcerIndex: number;
  readonly painIndex: number;

  // Recovery statistics
  readonly averageRecoveryMs: number;
  readonly longestDrawdownMs: number; // longest single drawdown duration
  readonly totalDrawdownPeriods: number;

  // Top-5 worst drawdowns (sorted by depth, worst first)
  readonly top5Drawdowns: DrawdownPeriod[];
}
