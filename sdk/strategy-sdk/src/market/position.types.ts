/**
 * SdkAssetBalance is the holdings of a single asset (e.g. BTC, USDT).
 *
 * free   = immediately available for trading or withdrawal
 * locked = reserved by open orders or margin collateral
 * total  = free + locked
 */
export interface SdkAssetBalance {
  readonly asset: string;
  readonly free: number;
  readonly locked: number;
  readonly total: number;
}

/**
 * SdkOpenPosition is a snapshot of one open futures/margin position.
 *
 * Spot accounts have no positions — getOpenPositions() returns [] on spot.
 *
 * side: 'LONG'  — profit when price rises
 * side: 'SHORT' — profit when price falls
 *
 * unrealizedPnl is denominated in the settlement currency (usually USDT).
 */
export interface SdkOpenPosition {
  readonly symbol: string;
  readonly side: 'LONG' | 'SHORT';
  readonly quantity: number;
  readonly notionalValue: number;
  readonly unrealizedPnl: number;
  readonly leverage: number;
  readonly entryPrice: number;
  readonly liquidationPrice: number | null;
}

/**
 * SdkPortfolioSnapshot is a point-in-time view of the account's financial state.
 *
 * equity          = totalUnrealizedPnl + availableBalance + lockedMargin
 * availableBalance= funds immediately usable for new positions
 * totalExposure   = sum of all open position notional values
 * currentLeverage = totalExposure / equity
 * snapshotAt      = UNIX millisecond timestamp of when this snapshot was taken
 */
export interface SdkPortfolioSnapshot {
  readonly equity: number;
  readonly availableBalance: number;
  readonly totalExposure: number;
  readonly currentLeverage: number;
  readonly openPositions: readonly SdkOpenPosition[];
  readonly unrealizedPnl: number;
  readonly snapshotAt: number;
}
