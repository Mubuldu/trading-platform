import { Injectable } from '@nestjs/common';
import { OrderSide, OrderType } from '@modules/exchange/enums/order.enums';
import { Candle } from '@modules/indicator/domain/models/candle.model';
import { BacktestOrder } from '../../domain/models/backtest-order.model';
import { FillType } from '../../domain/enums/fill-type.enum';
import { BacktestConfig } from '../../domain/models/backtest-config.model';
import { ICommissionModel } from '../commission/interfaces/commission-model.interface';
import { ISlippageModel } from '../slippage/interfaces/slippage-model.interface';
import { PercentageCommissionModel } from '../commission/percentage-commission.model';
import { FixedSlippageModel } from '../slippage/fixed-slippage.model';
import { OrderQueueService } from './order-queue.service';
import { SimulatedFill, OrderSubmission } from './fill-model';

const DEFAULT_VOLUME_PARTICIPATION = 0.05;

@Injectable()
export class ExecutionSimulatorService {
  private commissionModel!: ICommissionModel;
  private slippageModel!: ISlippageModel;
  private config!: BacktestConfig;
  private readonly completedOrders: BacktestOrder[] = [];

  constructor(private readonly queue: OrderQueueService) {}

  configure(config: BacktestConfig): void {
    this.config = config;
    this.commissionModel = new PercentageCommissionModel(
      config.commission.makerBps,
      config.commission.takerBps,
    );
    this.slippageModel = new FixedSlippageModel(config.slippage.fixedBps);
    this.queue.reset();
    this.completedOrders.length = 0;
  }

  submitOrder(submission: OrderSubmission): BacktestOrder {
    return this.queue.enqueue(submission);
  }

  processMarketOrdersAtOpen(candle: Candle): SimulatedFill[] {
    const fills: SimulatedFill[] = [];
    const marketOrders = this.queue.getMarketOrders().filter((o) => o.symbol === candle.symbol);

    for (const order of marketOrders) {
      const rawPrice = candle.open;
      const fillPrice = this.slippageModel.adjust(
        rawPrice,
        order.side,
        order.type,
        order.requestedQuantity,
        candle,
      );

      const maxFillQty = this.computeMaxFillQuantity(order.remainingQuantity, fillPrice, candle);
      const fillQty = Math.min(order.remainingQuantity, maxFillQty);
      const commission = this.commissionModel.calculate(fillQty, fillPrice, order.side, false);

      this.queue.markFilled(order.orderId, fillQty, fillPrice, commission, candle.openTime);

      const fill: SimulatedFill = {
        order,
        fillType: FillType.MARKET_AT_OPEN,
        filledQuantity: fillQty,
        fillPrice,
        commission,
        slippage: Math.abs(fillPrice - rawPrice) * fillQty,
        fillTime: candle.openTime,
        isMaker: false,
        isPartial: fillQty < order.requestedQuantity,
      };

      fills.push(fill);
      this.completedOrders.push(order);
    }

    return fills;
  }

  processLimitOrders(candle: Candle): SimulatedFill[] {
    const fills: SimulatedFill[] = [];
    const limitOrders = this.queue.getLimitOrders().filter((o) => o.symbol === candle.symbol);

    for (const order of limitOrders) {
      if (!order.requestedPrice) continue;

      const limitPrice = order.requestedPrice;
      let triggered = false;

      if (order.side === OrderSide.BUY && candle.low <= limitPrice) {
        triggered = true;
      } else if (order.side === OrderSide.SELL && candle.high >= limitPrice) {
        triggered = true;
      }

      if (!triggered) continue;

      const fillPrice = limitPrice;
      const fillQty = order.remainingQuantity;
      const commission = this.commissionModel.calculate(fillQty, fillPrice, order.side, true);

      this.queue.markFilled(order.orderId, fillQty, fillPrice, commission, candle.openTime);

      fills.push({
        order,
        fillType: FillType.LIMIT_PASSIVE,
        filledQuantity: fillQty,
        fillPrice,
        commission,
        slippage: 0,
        fillTime: candle.openTime,
        isMaker: true,
        isPartial: false,
      });

      this.completedOrders.push(order);
    }

    return fills;
  }

  processStopOrders(candle: Candle): SimulatedFill[] {
    const fills: SimulatedFill[] = [];
    const stopOrders = this.queue.getStopOrders().filter((o) => o.symbol === candle.symbol);

    for (const order of stopOrders) {
      if (!order.stopPrice) continue;

      const stopPrice = order.stopPrice;
      let triggered = false;
      let fillPrice = stopPrice;

      if (order.side === OrderSide.BUY && candle.high >= stopPrice) {
        triggered = true;
        fillPrice = Math.max(stopPrice, candle.open);
      } else if (order.side === OrderSide.SELL && candle.low <= stopPrice) {
        triggered = true;
        fillPrice = Math.min(stopPrice, candle.open);
      }

      if (!triggered) continue;

      fillPrice = this.slippageModel.adjust(
        fillPrice,
        order.side,
        order.type,
        order.remainingQuantity,
        candle,
      );

      if (order.type === OrderType.STOP_LIMIT && order.limitPrice) {
        if (order.side === OrderSide.BUY && fillPrice > order.limitPrice) continue;
        if (order.side === OrderSide.SELL && fillPrice < order.limitPrice) continue;
      }

      const fillQty = order.remainingQuantity;
      const commission = this.commissionModel.calculate(fillQty, fillPrice, order.side, false);
      this.queue.markFilled(order.orderId, fillQty, fillPrice, commission, candle.openTime);

      fills.push({
        order,
        fillType: FillType.STOP_TRIGGERED,
        filledQuantity: fillQty,
        fillPrice,
        commission,
        slippage: Math.abs(fillPrice - stopPrice) * fillQty,
        fillTime: candle.openTime,
        isMaker: false,
        isPartial: false,
      });

      this.completedOrders.push(order);
    }

    return fills;
  }

  processTrailingStops(
    candle: Candle,
    _currentSidePrice: (o: BacktestOrder) => number,
  ): SimulatedFill[] {
    const fills: SimulatedFill[] = [];
    const trailingOrders = this.queue
      .getTrailingStopOrders()
      .filter((o) => o.symbol === candle.symbol);

    for (const order of trailingOrders) {
      if (!order.trailingDeltaPercent) continue;

      const deltaFactor = order.trailingDeltaPercent / 100;

      if (order.side === OrderSide.SELL) {
        const newPeak =
          order.trailPeakPrice != null ? Math.max(order.trailPeakPrice, candle.high) : candle.high;
        const newStop = newPeak * (1 - deltaFactor);
        this.queue.updateTrailStop(order.orderId, newPeak, newStop);

        if (order.trailStopPrice != null && candle.low <= order.trailStopPrice) {
          const fillPrice = this.slippageModel.adjust(
            order.trailStopPrice,
            order.side,
            order.type,
            order.remainingQuantity,
            candle,
          );
          const fillQty = order.remainingQuantity;
          const commission = this.commissionModel.calculate(fillQty, fillPrice, order.side, false);
          this.queue.markFilled(order.orderId, fillQty, fillPrice, commission, candle.openTime);

          fills.push({
            order,
            fillType: FillType.TRAILING_STOP_TRIGGERED,
            filledQuantity: fillQty,
            fillPrice,
            commission,
            slippage: Math.abs(fillPrice - order.trailStopPrice) * fillQty,
            fillTime: candle.openTime,
            isMaker: false,
            isPartial: false,
          });

          this.completedOrders.push(order);
        }
      } else if (order.side === OrderSide.BUY) {
        const newTrough =
          order.trailPeakPrice != null ? Math.min(order.trailPeakPrice, candle.low) : candle.low;
        const newStop = newTrough * (1 + deltaFactor);
        this.queue.updateTrailStop(order.orderId, newTrough, newStop);

        if (order.trailStopPrice != null && candle.high >= order.trailStopPrice) {
          const fillPrice = this.slippageModel.adjust(
            order.trailStopPrice,
            order.side,
            order.type,
            order.remainingQuantity,
            candle,
          );
          const fillQty = order.remainingQuantity;
          const commission = this.commissionModel.calculate(fillQty, fillPrice, order.side, false);
          this.queue.markFilled(order.orderId, fillQty, fillPrice, commission, candle.openTime);

          fills.push({
            order,
            fillType: FillType.TRAILING_STOP_TRIGGERED,
            filledQuantity: fillQty,
            fillPrice,
            commission,
            slippage: Math.abs(fillPrice - order.trailStopPrice) * fillQty,
            fillTime: candle.openTime,
            isMaker: false,
            isPartial: false,
          });

          this.completedOrders.push(order);
        }
      }
    }

    return fills;
  }

  processAllOrdersForCandle(candle: Candle): SimulatedFill[] {
    const marketFills = this.processMarketOrdersAtOpen(candle);
    const limitFills = this.processLimitOrders(candle);
    const stopFills = this.processStopOrders(candle);
    const trailFills = this.processTrailingStops(candle, () => candle.close);
    return [...marketFills, ...limitFills, ...stopFills, ...trailFills];
  }

  getCompletedOrders(): BacktestOrder[] {
    return [...this.completedOrders];
  }

  getAllOrders(): BacktestOrder[] {
    const pending = this.queue.getAll();
    return [...this.completedOrders, ...pending];
  }

  expireOpenOrders(_currentTime: number): BacktestOrder[] {
    return this.queue.cancelAll();
  }

  private computeMaxFillQuantity(requestedQty: number, _price: number, candle: Candle): number {
    const participationRate =
      this.config?.slippage?.volumeParticipationRate ?? DEFAULT_VOLUME_PARTICIPATION;
    const maxByVolume = candle.volume > 0 ? candle.volume * participationRate : requestedQty;
    return Math.min(requestedQty, Math.max(maxByVolume, requestedQty));
  }
}
