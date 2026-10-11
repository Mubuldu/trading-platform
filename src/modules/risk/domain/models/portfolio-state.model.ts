export interface OpenPositionSnapshot {
  readonly symbol: string;
  readonly side: string;
  readonly quantity: number;
  readonly notionalValue: number;
  readonly unrealizedPnl: number;
  readonly leverage: number;
}

export interface PortfolioSnapshot {
  readonly equity: number;
  readonly availableBalance: number;
  readonly totalExposure: number;
  readonly currentLeverage: number;
  readonly openPositions: OpenPositionSnapshot[];
  readonly unrealizedPnl: number;
  readonly snapshotAt: number;
}
