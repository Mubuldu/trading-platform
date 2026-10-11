import { FillType } from '../../domain/enums/fill-type.enum';
import { BacktestOrder } from '../../domain/models/backtest-order.model';

export interface SimulatedFill {
  readonly order: BacktestOrder;
  readonly fillType: FillType;
  readonly filledQuantity: number;
  readonly fillPrice: number;
  readonly commission: number;
  readonly slippage: number;
  readonly fillTime: number;
  readonly isMaker: boolean;
  readonly isPartial: boolean;
}

export interface OrderSubmission {
  readonly strategyId: string;
  readonly symbol: string;
  readonly side: import('@modules/exchange/enums/order.enums').OrderSide;
  readonly type: import('@modules/exchange/enums/order.enums').OrderType;
  readonly quantity: number;
  readonly price?: number;
  readonly stopPrice?: number;
  readonly limitPrice?: number;
  readonly trailingDeltaPercent?: number;
  readonly submittedAtBarTime: number;
}
