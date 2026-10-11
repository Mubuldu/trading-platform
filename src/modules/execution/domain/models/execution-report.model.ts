import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import { OrderSide, OrderStatus, OrderType } from '@modules/exchange/enums/order.enums';
import { ExecutionStatus } from '../enums/execution-status.enum';
import { ExecutionReportType } from '../enums/execution-report-type.enum';
import { LatencySample } from './latency-sample.model';

export interface ExecutionReportModel {
  readonly reportId: string;
  readonly requestId: string;
  readonly decisionId: string;
  readonly strategyId: string;
  readonly exchangeId: ExchangeId;
  readonly symbol: string;
  readonly side: OrderSide;
  readonly orderType: OrderType;
  readonly reportType: ExecutionReportType;
  readonly status: ExecutionStatus;
  readonly exchangeOrderId?: string;
  readonly clientOrderId: string;
  readonly requestedQuantity: number;
  readonly executedQuantity: number;
  readonly remainingQuantity: number;
  readonly averagePrice: number;
  readonly exchangeStatus?: OrderStatus;
  readonly retries: number;
  readonly latency: LatencySample;
  readonly errorMessage?: string;
  readonly generatedAt: number;
}
