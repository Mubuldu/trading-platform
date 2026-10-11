import { OrderSide } from '@modules/exchange/enums/order.enums';
import { ICommissionModel } from './interfaces/commission-model.interface';

export class ZeroCommissionModel implements ICommissionModel {
  readonly description = 'Zero commission';

  calculate(_quantity: number, _price: number, _side: OrderSide, _isMaker: boolean): number {
    return 0;
  }
}
