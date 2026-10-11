import { OrderSide } from '@modules/exchange/enums/order.enums';
import { ExecutionReportType } from '@modules/execution/domain/enums/execution-report-type.enum';
import { ExecutionStatus } from '@modules/execution/domain/enums/execution-status.enum';

export interface FillEventModel {
  readonly fillId: string;
  readonly requestId: string;
  readonly exchangeId: string;
  readonly symbol: string;
  readonly side: OrderSide;
  readonly executedQuantity: number;
  readonly remainingQuantity: number;
  readonly averagePrice: number;
  readonly reportType: ExecutionReportType;
  readonly status: ExecutionStatus;
  readonly strategyId: string;
  readonly generatedAt: number;
}
