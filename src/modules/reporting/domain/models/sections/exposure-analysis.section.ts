/**
 * ExposureSymbolRow — per-symbol exposure at snapshot time.
 */
export interface ExposureSymbolRow {
  readonly symbol: string;
  readonly direction: string; // 'LONG' | 'SHORT'
  readonly notional: number; // quote currency
  readonly percentOfEquity: number;
  readonly unrealizedPnl: number;
}

/**
 * ExposureStrategyRow — per-strategy exposure at snapshot time.
 */
export interface ExposureStrategyRow {
  readonly strategyId: string;
  readonly notional: number;
  readonly percentOfEquity: number;
  readonly positionCount: number;
}

/**
 * ExposureAnalysisSection — portfolio exposure breakdown and concentration risk.
 */
export interface ExposureAnalysisSection {
  // Aggregate
  readonly grossExposure: number;
  readonly netExposure: number;
  readonly longExposure: number;
  readonly shortExposure: number;

  // Utilisation
  readonly leverageUtilization: number;
  readonly marginUtilizationPercent: number;
  readonly cashUtilizationPercent: number;

  // Position counts
  readonly openPositionCount: number;
  readonly longPositionCount: number;
  readonly shortPositionCount: number;

  // Top positions (sorted by notional descending, max 10)
  readonly topSymbolsByExposure: ExposureSymbolRow[];

  // Strategy breakdown (sorted by notional descending)
  readonly exposureByStrategy: ExposureStrategyRow[];
}
