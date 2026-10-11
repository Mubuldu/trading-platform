export interface RiskMetricsModel {
  readonly sharpeRatio: number;
  readonly sortinoRatio: number;
  readonly calmarRatio: number;
  readonly maxDrawdown: number;
  readonly maxDrawdownAbsolute: number;
  readonly rollingDrawdown: number;
  readonly volatilityAnnualized: number;
  readonly recoveryFactor: number;
  readonly profitFactor: number;
  readonly expectancy: number;
  readonly computedAt: number;
}
