import { OrderSide } from '@modules/exchange/enums/order.enums';
import { ICommissionModel } from './interfaces/commission-model.interface';

export class PercentageCommissionModel implements ICommissionModel {
  readonly description: string;

  constructor(
    private readonly makerBps: number,
    private readonly takerBps: number,
  ) {
    this.description = `Percentage commission: maker=${makerBps}bps, taker=${takerBps}bps`;
  }

  calculate(quantity: number, price: number, _side: OrderSide, isMaker: boolean): number {
    const bps = isMaker ? this.makerBps : this.takerBps;
    return quantity * price * (bps / 10_000);
  }
}
