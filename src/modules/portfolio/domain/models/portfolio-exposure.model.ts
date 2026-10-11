export interface DirectionExposure {
  readonly long: number;
  readonly short: number;
  readonly net: number;
  readonly gross: number;
}

export interface PortfolioExposureModel {
  readonly bySymbol: Record<string, number>;
  readonly byAsset: Record<string, number>;
  readonly byExchange: Record<string, number>;
  readonly byStrategy: Record<string, number>;
  readonly byDirection: DirectionExposure;
  readonly totalGrossExposure: number;
  readonly totalNetExposure: number;
  readonly computedAt: number;
}
