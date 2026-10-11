import { Injectable } from '@nestjs/common';
import { PositionDirection } from '../../domain/enums/position-direction.enum';

export interface PnlSnapshot {
  readonly realizedPnl: number;
  readonly unrealizedPnl: number;
  readonly grossPnl: number;
  readonly netPnl: number;
  readonly feeAdjustedPnl: number;
}

export interface AverageEntryResult {
  readonly newAverageEntryPrice: number;
  readonly newQuantity: number;
}

@Injectable()
export class PnlCalculatorService {
  /**
   * Recalculates weighted average entry price when adding to an existing position.
   * newAvg = (existingQty * existingAvg + fillQty * fillPrice) / (existingQty + fillQty)
   */
  recalculateAverageEntry(
    existingQuantity: number,
    existingAveragePrice: number,
    fillQuantity: number,
    fillPrice: number,
  ): AverageEntryResult {
    const totalQuantity = existingQuantity + fillQuantity;
    if (totalQuantity === 0) {
      return { newAverageEntryPrice: 0, newQuantity: 0 };
    }
    const newAverage =
      (existingQuantity * existingAveragePrice + fillQuantity * fillPrice) / totalQuantity;
    return { newAverageEntryPrice: newAverage, newQuantity: totalQuantity };
  }

  /**
   * Realized PnL from closing/reducing a position.
   * LONG:  (closePrice - avgEntry) * closedQty
   * SHORT: (avgEntry - closePrice) * closedQty
   */
  calculateRealizedPnlFromClose(
    direction: PositionDirection,
    closedQuantity: number,
    averageEntryPrice: number,
    closePrice: number,
  ): number {
    if (direction === PositionDirection.LONG) {
      return (closePrice - averageEntryPrice) * closedQuantity;
    }
    if (direction === PositionDirection.SHORT) {
      return (averageEntryPrice - closePrice) * closedQuantity;
    }
    return 0;
  }

  /**
   * Unrealized PnL against a mark price.
   * LONG:  (markPrice - avgEntry) * quantity
   * SHORT: (avgEntry - markPrice) * quantity
   *
   * When no external mark price is available, pass the last fill price.
   */
  calculateUnrealizedPnl(
    direction: PositionDirection,
    quantity: number,
    averageEntryPrice: number,
    markPrice: number,
  ): number {
    if (direction === PositionDirection.LONG) {
      return (markPrice - averageEntryPrice) * quantity;
    }
    if (direction === PositionDirection.SHORT) {
      return (averageEntryPrice - markPrice) * quantity;
    }
    return 0;
  }

  buildSnapshot(realizedPnl: number, unrealizedPnl: number, totalFees: number): PnlSnapshot {
    const grossPnl = realizedPnl + unrealizedPnl;
    const netPnl = grossPnl;
    const feeAdjustedPnl = netPnl - totalFees;
    return { realizedPnl, unrealizedPnl, grossPnl, netPnl, feeAdjustedPnl };
  }
}
