import { Injectable } from '@nestjs/common';
import { Order } from '@modules/exchange/models/trading.models';
import { OrderStatus } from '@modules/exchange/enums/order.enums';
import { ExecutionRequestModel } from '../../domain/models/execution-request.model';
import { ExecutionStatus } from '../../domain/enums/execution-status.enum';
import { ExecutionReportType } from '../../domain/enums/execution-report-type.enum';

export interface FillSummary {
  readonly executedQuantity: number;
  readonly remainingQuantity: number;
  readonly averagePrice: number;
  readonly fillPercent: number;
  readonly isFullFill: boolean;
  readonly isPartialFill: boolean;
  readonly status: ExecutionStatus;
  readonly reportType: ExecutionReportType;
}

@Injectable()
export class FillProcessorService {
  process(request: ExecutionRequestModel, order: Order): FillSummary {
    const executedQuantity = order.executedQuantity;
    const remainingQuantity = order.remainingQuantity;
    const averagePrice = order.averagePrice || order.price || 0;
    const fillPercent = request.quantity > 0 ? (executedQuantity / request.quantity) * 100 : 0;
    const isFullFill = order.status === OrderStatus.FILLED;
    const isPartialFill = order.status === OrderStatus.PARTIALLY_FILLED;

    return {
      executedQuantity,
      remainingQuantity,
      averagePrice,
      fillPercent,
      isFullFill,
      isPartialFill,
      status: this.toExecutionStatus(order.status),
      reportType: this.toReportType(order.status),
    };
  }

  private toExecutionStatus(orderStatus: OrderStatus): ExecutionStatus {
    switch (orderStatus) {
      case OrderStatus.NEW:
        return ExecutionStatus.OPEN;
      case OrderStatus.PARTIALLY_FILLED:
        return ExecutionStatus.PARTIALLY_FILLED;
      case OrderStatus.FILLED:
        return ExecutionStatus.FILLED;
      case OrderStatus.CANCELLED:
        return ExecutionStatus.CANCELLED;
      case OrderStatus.REJECTED:
        return ExecutionStatus.REJECTED;
      case OrderStatus.EXPIRED:
        return ExecutionStatus.EXPIRED;
      default:
        return ExecutionStatus.SUBMITTED;
    }
  }

  private toReportType(orderStatus: OrderStatus): ExecutionReportType {
    switch (orderStatus) {
      case OrderStatus.NEW:
        return ExecutionReportType.ORDER_ACCEPTED;
      case OrderStatus.PARTIALLY_FILLED:
        return ExecutionReportType.ORDER_PARTIALLY_FILLED;
      case OrderStatus.FILLED:
        return ExecutionReportType.ORDER_FILLED;
      case OrderStatus.CANCELLED:
        return ExecutionReportType.ORDER_CANCELLED;
      case OrderStatus.REJECTED:
        return ExecutionReportType.ORDER_REJECTED;
      case OrderStatus.EXPIRED:
        return ExecutionReportType.ORDER_EXPIRED;
      default:
        return ExecutionReportType.ORDER_PENDING;
    }
  }
}
