import { OrderSide, OrderType } from '@modules/exchange/enums/order.enums';
import { Candle } from '@modules/indicator/domain/models/candle.model';

export interface ISlippageModel {
  adjust(
    requestedPrice: number,
    side: OrderSide,
    orderType: OrderType,
    quantity: number,
    candle: Candle,
  ): number;

  readonly description: string;
}
