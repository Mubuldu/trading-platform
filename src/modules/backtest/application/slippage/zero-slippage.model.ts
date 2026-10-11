import { OrderSide, OrderType } from '@modules/exchange/enums/order.enums';
import { Candle } from '@modules/indicator/domain/models/candle.model';
import { ISlippageModel } from './interfaces/slippage-model.interface';

export class ZeroSlippageModel implements ISlippageModel {
  readonly description = 'Zero slippage';

  adjust(
    requestedPrice: number,
    _side: OrderSide,
    _orderType: OrderType,
    _quantity: number,
    _candle: Candle,
  ): number {
    return requestedPrice;
  }
}
