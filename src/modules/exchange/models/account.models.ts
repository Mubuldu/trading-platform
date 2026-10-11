import { ExchangeModelBase, NormalizedSymbol } from './common.model';
import { PositionSide, MarginMode } from '../enums/position.enums';
import { ExchangeId } from '../enums/exchange.enums';

export type TradingPermission = 'SPOT' | 'MARGIN' | 'FUTURES' | 'OPTIONS' | 'DELIVERY';

/**
 * AssetBalance represents holdings of a single asset.
 *
 * free:   available for new orders or withdrawal
 * locked: held by open orders or collateral
 * total:  free + locked
 */
export interface AssetBalance {
  readonly asset: string;
  readonly free: number;
  readonly locked: number;
  readonly total: number;
}

/**
 * Balance is the normalized snapshot of an account's holdings.
 *
 * assets is a map keyed by asset code (BTC, USDT, ETH, etc.).
 * Equity and margin fields are populated for margin/futures accounts;
 * they are undefined for spot-only accounts.
 */
export interface Balance {
  readonly exchangeId: ExchangeId;
  readonly timestamp: Date;
  readonly receivedAt: Date;
  readonly assets: Record<string, AssetBalance>;
  readonly totalEquity?: number;
  readonly totalUnrealizedPnl?: number;
  readonly totalMarginBalance?: number;
  readonly availableBalance?: number;
  readonly initialMargin?: number;
  readonly maintenanceMargin?: number;
}

/**
 * Position is the normalized representation of an open futures/margin position.
 */
export interface Position extends ExchangeModelBase {
  readonly positionSide: PositionSide;
  readonly marginMode: MarginMode;
  readonly leverage: number;
  readonly entryPrice: number;
  readonly markPrice?: number;
  readonly quantity: number;
  readonly notionalValue: number;
  readonly unrealizedPnl: number;
  readonly realizedPnl: number;
  readonly liquidationPrice?: number;
  readonly marginUsed: number;
  readonly maintenanceMargin: number;
  readonly positionValue: number;
  readonly isAutoAddMargin?: boolean;
  readonly adlQuantile?: number;
}

/**
 * AccountInfo describes the account's configuration and permissions.
 */
export interface AccountInfo {
  readonly exchangeId: ExchangeId;
  readonly timestamp: Date;
  readonly receivedAt: Date;
  readonly accountId?: string;
  readonly accountType: string;
  readonly permissions: TradingPermission[];
  readonly canTrade: boolean;
  readonly canWithdraw: boolean;
  readonly canDeposit: boolean;
  readonly makerCommission?: number;
  readonly takerCommission?: number;
  readonly buyerCommission?: number;
  readonly sellerCommission?: number;
  readonly updateTime: Date;
}

/**
 * FeeRateInfo describes maker/taker fees for a symbol or account tier.
 */
export interface FeeRateInfo {
  readonly symbol?: NormalizedSymbol;
  readonly makerFee: number;
  readonly takerFee: number;
  readonly feeCurrency?: string;
}

/**
 * FeeRates is the complete fee schedule for an account.
 *
 * symbolFees overrides defaultFees for specific symbols (e.g. maker fee
 * rebates on high-volume pairs).
 */
export interface FeeRates {
  readonly exchangeId: ExchangeId;
  readonly timestamp: Date;
  readonly receivedAt: Date;
  readonly defaultFees: FeeRateInfo;
  readonly symbolFees: Record<string, FeeRateInfo>;
  readonly discount?: number;
  readonly vipLevel?: number;
}
