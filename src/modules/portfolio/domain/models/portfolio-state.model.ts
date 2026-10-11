export interface PositionSummary {
  readonly positionId: string;
  readonly exchangeId: string;
  readonly symbol: string;
  readonly asset: string;
  readonly strategyId: string;
  readonly direction: string;
  readonly state: string;
  readonly quantity: number;
  readonly averageEntryPrice: number;
  readonly notionalValue: number;
  readonly unrealizedPnl: number;
  readonly realizedPnl: number;
  readonly totalFees: number;
  readonly updatedAt: number;
}

export interface PortfolioStateModel {
  readonly accountEquity: number;
  readonly availableBalance: number;
  readonly marginUsed: number;
  readonly buyingPower: number;

  readonly realizedPnl: number;
  readonly unrealizedPnl: number;
  readonly totalFees: number;
  readonly totalFunding: number;
  readonly netPnl: number;

  readonly totalExposure: number;
  readonly totalLeverage: number;

  readonly openPositionCount: number;
  readonly positions: PositionSummary[];

  readonly snapshotAt: number;
}
