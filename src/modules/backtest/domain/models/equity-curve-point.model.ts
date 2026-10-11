export interface EquityCurvePoint {
  readonly timestamp: number;
  readonly equity: number;
  readonly cash: number;
  readonly unrealizedPnl: number;
  readonly peakEquity: number;
  readonly drawdown: number;
  readonly drawdownPercent: number;
}
