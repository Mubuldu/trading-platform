import { OrderSide } from '@modules/exchange/enums/order.enums';

export interface ICommissionModel {
  calculate(quantity: number, price: number, side: OrderSide, isMaker: boolean): number;

  readonly description: string;
}
