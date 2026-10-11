import { PositionState } from '../enums/position-state.enum';
import { PositionDirection } from '../enums/position-direction.enum';

export interface FillRecord {
  fillId: string;
  quantity: number;
  price: number;
  timestamp: number;
}

export interface PositionModel {
  readonly positionId: string;
  readonly exchangeId: string;
  readonly accountId: string;
  readonly symbol: string;
  readonly strategyId: string;

  direction: PositionDirection;
  state: PositionState;

  quantity: number;
  entryPrice: number;
  averageEntryPrice: number;

  realizedPnl: number;
  unrealizedPnl: number;
  grossPnl: number;
  netPnl: number;
  feeAdjustedPnl: number;

  totalFees: number;
  totalFunding: number;
  totalSlippage: number;

  openedAt: number;
  updatedAt: number;
  closedAt: number | null;

  version: number;
  fillIds: string[];
  fills: FillRecord[];
}

export function createFlatPosition(
  exchangeId: string,
  accountId: string,
  symbol: string,
  strategyId: string,
): PositionModel {
  return {
    positionId: `${exchangeId}:${symbol}`,
    exchangeId,
    accountId,
    symbol,
    strategyId,
    direction: PositionDirection.FLAT,
    state: PositionState.FLAT,
    quantity: 0,
    entryPrice: 0,
    averageEntryPrice: 0,
    realizedPnl: 0,
    unrealizedPnl: 0,
    grossPnl: 0,
    netPnl: 0,
    feeAdjustedPnl: 0,
    totalFees: 0,
    totalFunding: 0,
    totalSlippage: 0,
    openedAt: 0,
    updatedAt: Date.now(),
    closedAt: null,
    version: 0,
    fillIds: [],
    fills: [],
  };
}
