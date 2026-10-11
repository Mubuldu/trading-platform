import { OrderSide, OrderType } from '@modules/exchange/enums/order.enums';
import { Candle } from '@modules/indicator/domain/models/candle.model';
import { ISlippageModel } from './interfaces/slippage-model.interface';

export class FixedSlippageModel implements ISlippageModel {
  readonly description: string;

  constructor(private readonly slippageBps: number) {
    this.description = `Fixed slippage: ${slippageBps}bps`;
  }

  adjust(
    requestedPrice: number,
    side: OrderSide,
    orderType: OrderType,
    _quantity: number,
    _candle: Candle,
  ): number {
    if (orderType === OrderType.LIMIT) {
      return requestedPrice;
    }

    const factor = this.slippageBps / 10_000;
    if (side === OrderSide.BUY) {
      return requestedPrice * (1 + factor);
    }
    return requestedPrice * (1 - factor);
  }
}
