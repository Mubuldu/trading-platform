/**
 * ExposureMetrics describes the portfolio's current and historical exposure.
 *
 * grossExposure = sum of all position notionals (long + short, unsigned)
 * netExposure   = longExposure - shortExposure  (signed)
 * longExposure  = sum of notionals for LONG positions
 * shortExposure = sum of notionals for SHORT positions
 *
 * All monetary values are in quote currency (USDT).
 */
export interface ExposureMetrics {
  // Aggregate
  readonly grossExposure: number;
  readonly netExposure: number;
  readonly longExposure: number;
  readonly shortExposure: number;

  // Concentration breakdown
  readonly bySymbol: Record<
    string,
    {
      readonly direction: string;
      readonly quantity: number;
      readonly notional: number;
      readonly unrealizedPnl: number;
      readonly percentOfEquity: number;
    }
  >;

  readonly byStrategy: Record<
    string,
    {
      readonly notional: number;
      readonly percentOfEquity: number;
      readonly positionCount: number;
    }
  >;

  readonly byExchange: Record<
    string,
    {
      readonly notional: number;
      readonly percentOfEquity: number;
      readonly positionCount: number;
    }
  >;

  // Counts
  readonly longPositionCount: number;
  readonly shortPositionCount: number;
  readonly totalPositionCount: number;

  readonly snapshotAt: number;
}
