import { Injectable } from '@nestjs/common';
import { ok, err, Result } from '@common/result';
import { ExecutionReportModel } from '@modules/execution/domain/models/execution-report.model';
import { ExecutionReportType } from '@modules/execution/domain/enums/execution-report-type.enum';
import { OrderModel } from '../../domain/models/order.model';
import { OrderState, isTerminalState } from '../../domain/enums/order-state.enum';
import { ImpossibleOrderTransitionError, OrderError } from '../../domain/errors/order.errors';

export interface OrderTransitionResult {
  readonly previousState: OrderState;
  readonly nextState: OrderState;
  readonly isTerminal: boolean;
}

@Injectable()
export class OrderStateMachineService {
  apply(
    order: OrderModel,
    report: ExecutionReportModel,
  ): Result<OrderTransitionResult, OrderError> {
    if (isTerminalState(order.state)) {
      return err(
        new ImpossibleOrderTransitionError(
          order.state,
          report.reportType,
          'Order is already in a terminal state',
        ),
      );
    }

    const previousState = order.state;
    const now = report.generatedAt;

    switch (report.reportType) {
      case ExecutionReportType.ORDER_PENDING:
        this.setExchangeOrderId(order, report.exchangeOrderId);
        if (!order.submittedAt) order.submittedAt = now;
        order.executionAttempts++;
        this.advance(order, OrderState.SUBMITTED, now);
        break;

      case ExecutionReportType.ORDER_ACCEPTED:
        this.setExchangeOrderId(order, report.exchangeOrderId);
        if (!order.submittedAt) order.submittedAt = now;
        if (!order.acknowledgedAt) order.acknowledgedAt = now;
        order.executionAttempts++;
        // ACKNOWLEDGED then immediately OPEN — order is live on the book
        this.advance(order, OrderState.ACKNOWLEDGED, now);
        this.advance(order, OrderState.OPEN, now);
        break;

      case ExecutionReportType.ORDER_PARTIALLY_FILLED:
        this.setExchangeOrderId(order, report.exchangeOrderId);
        if (!order.acknowledgedAt) order.acknowledgedAt = now;
        if (!order.firstFillAt) order.firstFillAt = now;
        this.applyFillData(order, report);
        this.advance(order, OrderState.PARTIALLY_FILLED, now);
        break;

      case ExecutionReportType.ORDER_FILLED: {
        this.setExchangeOrderId(order, report.exchangeOrderId);
        if (!order.acknowledgedAt) order.acknowledgedAt = now;
        if (!order.firstFillAt) order.firstFillAt = now;
        order.filledAt = now;
        order.closedAt = now;
        this.applyFillData(order, report);
        this.advance(order, OrderState.FILLED, now);
        // Auto-archive to CLOSED
        this.advance(order, OrderState.CLOSED, now);
        break;
      }

      case ExecutionReportType.ORDER_CANCELLED:
        this.setExchangeOrderId(order, report.exchangeOrderId);
        order.closedAt = now;
        this.advance(order, OrderState.CANCELLED, now);
        break;

      case ExecutionReportType.ORDER_REJECTED:
        order.closedAt = now;
        order.errorMessage = report.errorMessage;
        this.advance(order, OrderState.REJECTED, now);
        break;

      case ExecutionReportType.ORDER_EXPIRED:
        this.setExchangeOrderId(order, report.exchangeOrderId);
        order.closedAt = now;
        this.advance(order, OrderState.EXPIRED, now);
        break;

      case ExecutionReportType.SUBMISSION_FAILED:
        order.closedAt = now;
        order.errorMessage = report.errorMessage;
        this.advance(order, OrderState.FAILED, now);
        break;

      case ExecutionReportType.ORDER_MODIFIED:
        this.setExchangeOrderId(order, report.exchangeOrderId);
        // Quantity/price updates only — state unchanged
        if (report.requestedQuantity > 0) {
          order.requestedQuantity = report.requestedQuantity;
          order.remainingQuantity = report.remainingQuantity;
        }
        order.updatedAt = now;
        break;

      default:
        return err(
          new ImpossibleOrderTransitionError(
            order.state,
            report.reportType,
            `Unhandled report type "${report.reportType}"`,
          ),
        );
    }

    order.reportIds.push(report.reportId);
    order.updatedAt = now;
    order.version++;

    return ok({
      previousState,
      nextState: order.state,
      isTerminal: isTerminalState(order.state),
    });
  }

  private advance(order: OrderModel, next: OrderState, now: number): void {
    order.state = next;
    order.updatedAt = now;
  }

  private applyFillData(order: OrderModel, report: ExecutionReportModel): void {
    order.executedQuantity = report.executedQuantity;
    order.remainingQuantity = report.remainingQuantity;
    if (report.averagePrice > 0) {
      order.averagePrice = report.averagePrice;
    }
  }

  private setExchangeOrderId(order: OrderModel, exchangeOrderId?: string): void {
    if (!order.exchangeOrderId && exchangeOrderId) {
      order.exchangeOrderId = exchangeOrderId;
    }
  }
}
