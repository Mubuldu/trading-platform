/**
 * ExecutiveSummarySection — top-level snapshot of the most important numbers.
 *
 * Designed to fit on the "cover page" of any report format.
 * Every field here is derivable from AnalyticsSnapshot without additional I/O.
 */
export interface ExecutiveSummarySection {
  // Human-readable context
  readonly title: string; // e.g. "Daily Report — 2024-01-15"
  readonly periodLabel: string; // e.g. "January 15, 2024 (Daily)"
  readonly sourceLabel: string; // e.g. "Paper Trading"
  readonly generatedAt: string; // ISO-8601

  // Headline performance
  readonly netPnl: number;
  readonly netPnlPercent: number; // net PnL as % of initial capital
  readonly totalReturn: number; // cumulative since first trade (quote)
  readonly totalReturnPercent: number;
  readonly annualizedReturnPercent: number;

  // Risk-adjusted headline
  readonly sharpeRatio: number;
  readonly sortinoRatio: number;
  readonly calmarRatio: number;
  readonly maxDrawdown: number; // fractional
  readonly maxDrawdownPercent: number; // × 100 for display

  // Trade activity
  readonly totalTrades: number;
  readonly winRate: number; // fractional
  readonly profitFactor: number;
  readonly expectancy: number;

  // 30-day rolling context
  readonly rolling30dReturnPercent: number;
  readonly rolling30dSharpe: number;

  // Status flags — used by consumers to colour-code the summary
  readonly isProfit: boolean;
  readonly isPositiveSharpe: boolean;

  // Plain-text highlights (top 3 notable facts derived from metrics)
  readonly highlights: string[];
}
