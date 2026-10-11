import { OrderSide } from '@modules/exchange/enums/order.enums';

export interface TradeRecord {
  readonly tradeId: string;
  readonly strategyId: string;
  readonly symbol: string;
  readonly side: OrderSide;

  readonly entryTime: number;
  readonly exitTime: number;
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly quantity: number;

  readonly grossPnl: number;
  readonly commission: number;
  readonly netPnl: number;

  readonly durationMs: number;

  readonly maePercent: number;
  readonly mfePercent: number;

  readonly entryOrderId: string;
  readonly exitOrderId: string;
}
