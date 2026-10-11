export interface PortfolioSummaryModel {
  readonly totalOpenPositions: number;
  readonly winningPositions: number;
  readonly losingPositions: number;
  readonly breakEvenPositions: number;
  readonly totalExposure: number;
  readonly totalUnrealizedPnl: number;
  readonly totalRealizedPnl: number;
  readonly totalFees: number;
  readonly netPnl: number;
  readonly feeAdjustedPnl: number;
  readonly snapshotAt: number;
}
