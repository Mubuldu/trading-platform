import { OrderSide, OrderType } from '@modules/exchange/enums/order.enums';
import { BacktestOrderStatus } from '../enums/backtest-order-status.enum';
import { FillType } from '../enums/fill-type.enum';

export interface BacktestOrder {
  readonly orderId: string;
  readonly strategyId: string;
  readonly symbol: string;
  readonly side: OrderSide;
  readonly type: OrderType;

  readonly requestedQuantity: number;
  readonly requestedPrice?: number;
  readonly stopPrice?: number;
  readonly limitPrice?: number;
  readonly trailingDeltaPercent?: number;

  readonly submittedAtBarTime: number;
  readonly submittedAt: number;

  status: BacktestOrderStatus;

  filledQuantity: number;
  remainingQuantity: number;
  averagePrice: number;
  commission: number;
  fillType?: FillType;

  fillTime?: number;
  cancelTime?: number;

  trailPeakPrice?: number;
  trailStopPrice?: number;
}
