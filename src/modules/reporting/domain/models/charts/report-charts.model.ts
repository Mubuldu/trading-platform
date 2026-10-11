/**
 * ReportChartPoint — a single (timestamp, value) pair for continuous curves.
 */
export interface ReportChartPoint {
  readonly timestamp: number; // unix ms
  readonly date: string; // YYYY-MM-DD
  readonly value: number;
}

/**
 * MonthlyReturnPoint — a single month's return, used in the monthly heatmap.
 */
export interface MonthlyReturnPoint {
  readonly year: number;
  readonly month: number; // 1–12
  readonly label: string; // e.g. "Jan 2024"
  readonly returnPercent: number;
  readonly isProfit: boolean;
}

/**
 * DistributionBucket — a single bucket in a histogram distribution.
 *
 * label     — bucket range as string (e.g. "[-50, -25)")
 * count     — number of observations in this bucket
 * frequency — count / total (fractional)
 */
export interface DistributionBucket {
  readonly label: string;
  readonly rangeMin: number;
  readonly rangeMax: number;
  readonly count: number;
  readonly frequency: number;
}

/**
 * ReportCharts bundles all chart data payloads for a report.
 *
 * All series are chronologically ordered. Chart data contains only raw
 * numbers — rendering is the consumer's responsibility.
 *
 * equityCurve          — portfolio equity at each daily observation
 * balanceCurve         — cash balance (excludes unrealised PnL)
 * drawdownCurve        — peak-to-current drawdown at each daily observation (fractional)
 * rollingSharpe        — 30-day rolling Sharpe ratio at each daily observation
 * rollingVolatility    — 30-day rolling annualised volatility at each daily observation
 * monthlyReturns       — monthly return heatmap (one entry per calendar month)
 * tradeDistribution    — histogram of trade PnL by $ bucket
 * pnlDistribution      — histogram of cumulative daily PnL changes
 * holdingTimeDistribution — histogram of trade holding times by bucket (ms)
 */
export interface ReportCharts {
  readonly equityCurve: ReportChartPoint[];
  readonly balanceCurve: ReportChartPoint[];
  readonly drawdownCurve: ReportChartPoint[];
  readonly rollingSharpe: ReportChartPoint[];
  readonly rollingVolatility: ReportChartPoint[];
  readonly monthlyReturns: MonthlyReturnPoint[];
  readonly tradeDistribution: DistributionBucket[];
  readonly pnlDistribution: DistributionBucket[];
  readonly holdingTimeDistribution: DistributionBucket[];
}
