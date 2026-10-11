import { OrderSide, OrderType } from '@modules/exchange/enums/order.enums';
import { Candle } from '@modules/indicator/domain/models/candle.model';
import { ISlippageModel } from './interfaces/slippage-model.interface';

export class VolumeBasedSlippageModel implements ISlippageModel {
  readonly description: string;

  constructor(
    private readonly baseSlippageBps: number,
    private readonly maxSlippageBps: number,
    private readonly volumeParticipationRate: number,
  ) {
    this.description = `Volume-based slippage: base=${baseSlippageBps}bps, max=${maxSlippageBps}bps, participation=${volumeParticipationRate}`;
  }

  adjust(
    requestedPrice: number,
    side: OrderSide,
    orderType: OrderType,
    quantity: number,
    candle: Candle,
  ): number {
    if (orderType === OrderType.LIMIT) {
      return requestedPrice;
    }

    const orderValue = quantity * requestedPrice;
    const candleValue = candle.volume * requestedPrice;

    const participationRatio =
      candleValue > 0 ? orderValue / (candleValue * this.volumeParticipationRate) : 1;
    const effectiveBps = Math.min(
      this.baseSlippageBps * Math.sqrt(participationRatio),
      this.maxSlippageBps,
    );
    const factor = effectiveBps / 10_000;

    if (side === OrderSide.BUY) {
      return requestedPrice * (1 + factor);
    }
    return requestedPrice * (1 - factor);
  }
}
