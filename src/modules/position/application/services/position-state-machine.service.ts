import { Injectable } from '@nestjs/common';
import { ok, err, Result } from '@common/result/result';
import { OrderSide } from '@modules/exchange/enums/order.enums';
import { PositionModel } from '../../domain/models/position.model';
import { FillEventModel } from '../../domain/models/fill-event.model';
import { PositionState } from '../../domain/enums/position-state.enum';
import { PositionDirection } from '../../domain/enums/position-direction.enum';
import { PositionAction } from '../../domain/enums/position-action.enum';
import { ImpossibleStateTransitionError, PositionError } from '../../domain/errors/position.errors';
import { PnlCalculatorService } from './pnl-calculator.service';

export interface TransitionResult {
  readonly action: PositionAction;
  readonly realizedPnlDelta: number;
  readonly closedQuantity: number;
  readonly openedQuantity: number;
  readonly reverseQuantity: number;
}

@Injectable()
export class PositionStateMachineService {
  constructor(private readonly pnl: PnlCalculatorService) {}

  apply(position: PositionModel, fill: FillEventModel): Result<TransitionResult, PositionError> {
    const fillQty = fill.executedQuantity;
    const fillPrice = fill.averagePrice;
    const side = fill.side;

    if (position.state === PositionState.FLAT) {
      return this.applyOpen(position, fill, fillQty, fillPrice, side);
    }

    if (
      position.state === PositionState.OPEN ||
      position.state === PositionState.SCALING ||
      position.state === PositionState.REDUCING
    ) {
      return this.applyToOpenPosition(position, fill, fillQty, fillPrice, side);
    }

    return err(
      new ImpossibleStateTransitionError(
        position.state,
        'FILL',
        `Unhandled state "${position.state}"`,
      ),
    );
  }

  private applyOpen(
    position: PositionModel,
    fill: FillEventModel,
    qty: number,
    price: number,
    side: OrderSide,
  ): Result<TransitionResult, PositionError> {
    const direction = side === OrderSide.BUY ? PositionDirection.LONG : PositionDirection.SHORT;

    position.direction = direction;
    position.state = PositionState.OPEN;
    position.quantity = qty;
    position.entryPrice = price;
    position.averageEntryPrice = price;
    position.openedAt = fill.generatedAt;
    position.updatedAt = fill.generatedAt;
    position.closedAt = null;
    position.version += 1;
    position.fillIds.push(fill.fillId);
    position.fills.push({ fillId: fill.fillId, quantity: qty, price, timestamp: fill.generatedAt });

    return ok({
      action: PositionAction.OPEN,
      realizedPnlDelta: 0,
      closedQuantity: 0,
      openedQuantity: qty,
      reverseQuantity: 0,
    });
  }

  private applyToOpenPosition(
    position: PositionModel,
    fill: FillEventModel,
    qty: number,
    price: number,
    side: OrderSide,
  ): Result<TransitionResult, PositionError> {
    const isAddingToPosition =
      (position.direction === PositionDirection.LONG && side === OrderSide.BUY) ||
      (position.direction === PositionDirection.SHORT && side === OrderSide.SELL);

    if (isAddingToPosition) {
      return this.applyIncrease(position, fill, qty, price);
    } else {
      return this.applyReduce(position, fill, qty, price);
    }
  }

  private applyIncrease(
    position: PositionModel,
    fill: FillEventModel,
    qty: number,
    price: number,
  ): Result<TransitionResult, PositionError> {
    position.state = PositionState.SCALING;

    const { newAverageEntryPrice, newQuantity } = this.pnl.recalculateAverageEntry(
      position.quantity,
      position.averageEntryPrice,
      qty,
      price,
    );

    position.quantity = newQuantity;
    position.averageEntryPrice = newAverageEntryPrice;
    position.state = PositionState.OPEN;
    position.updatedAt = fill.generatedAt;
    position.version += 1;
    position.fillIds.push(fill.fillId);
    position.fills.push({ fillId: fill.fillId, quantity: qty, price, timestamp: fill.generatedAt });

    return ok({
      action: PositionAction.INCREASE,
      realizedPnlDelta: 0,
      closedQuantity: 0,
      openedQuantity: qty,
      reverseQuantity: 0,
    });
  }

  private applyReduce(
    position: PositionModel,
    fill: FillEventModel,
    qty: number,
    price: number,
  ): Result<TransitionResult, PositionError> {
    position.state = PositionState.REDUCING;

    const currentQty = position.quantity;

    if (qty < currentQty) {
      // Partial close
      const realizedPnlDelta = this.pnl.calculateRealizedPnlFromClose(
        position.direction,
        qty,
        position.averageEntryPrice,
        price,
      );

      position.quantity = currentQty - qty;
      position.realizedPnl += realizedPnlDelta;
      position.state = PositionState.OPEN;
      position.updatedAt = fill.generatedAt;
      position.version += 1;
      position.fillIds.push(fill.fillId);
      position.fills.push({
        fillId: fill.fillId,
        quantity: qty,
        price,
        timestamp: fill.generatedAt,
      });

      return ok({
        action: PositionAction.PARTIAL_CLOSE,
        realizedPnlDelta,
        closedQuantity: qty,
        openedQuantity: 0,
        reverseQuantity: 0,
      });
    }

    if (qty === currentQty) {
      // Full close
      const realizedPnlDelta = this.pnl.calculateRealizedPnlFromClose(
        position.direction,
        qty,
        position.averageEntryPrice,
        price,
      );

      position.quantity = 0;
      position.realizedPnl += realizedPnlDelta;
      position.state = PositionState.FLAT;
      position.direction = PositionDirection.FLAT;
      position.updatedAt = fill.generatedAt;
      position.closedAt = fill.generatedAt;
      position.version += 1;
      position.fillIds.push(fill.fillId);
      position.fills.push({
        fillId: fill.fillId,
        quantity: qty,
        price,
        timestamp: fill.generatedAt,
      });

      return ok({
        action: PositionAction.CLOSE,
        realizedPnlDelta,
        closedQuantity: qty,
        openedQuantity: 0,
        reverseQuantity: 0,
      });
    }

    // Reverse: qty > currentQty — close entire position then open opposite
    const excessQty = qty - currentQty;

    const realizedPnlDelta = this.pnl.calculateRealizedPnlFromClose(
      position.direction,
      currentQty,
      position.averageEntryPrice,
      price,
    );

    const newDirection =
      position.direction === PositionDirection.LONG
        ? PositionDirection.SHORT
        : PositionDirection.LONG;

    position.quantity = excessQty;
    position.realizedPnl += realizedPnlDelta;
    position.direction = newDirection;
    position.averageEntryPrice = price;
    position.entryPrice = price;
    position.state = PositionState.OPEN;
    position.closedAt = null;
    position.updatedAt = fill.generatedAt;
    position.version += 1;
    position.fillIds.push(fill.fillId);
    position.fills.push({ fillId: fill.fillId, quantity: qty, price, timestamp: fill.generatedAt });

    return ok({
      action: PositionAction.REVERSE,
      realizedPnlDelta,
      closedQuantity: currentQty,
      openedQuantity: excessQty,
      reverseQuantity: excessQty,
    });
  }
}
