import { FillProcessorService } from '../../../src/modules/execution/application/services/fill-processor.service';
import { ExecutionStatus } from '../../../src/modules/execution/domain/enums/execution-status.enum';
import { ExecutionReportType } from '../../../src/modules/execution/domain/enums/execution-report-type.enum';
import { ExchangeId } from '../../../src/modules/exchange/enums/exchange.enums';
import {
  OrderSide,
  OrderType,
  OrderStatus,
  TimeInForce,
} from '../../../src/modules/exchange/enums/order.enums';
import { ExecutionRequestModel } from '../../../src/modules/execution/domain/models/execution-request.model';

function makeRequest(quantity = 0.1): ExecutionRequestModel {
  return {
    requestId: 'req-1',
    decisionId: 'd-1',
    strategyId: 'strat-1',
    signalId: 'sig-1',
    exchangeId: ExchangeId.PAPER_TRADING,
    symbol: 'BTC/USDT',
    side: OrderSide.BUY,
    orderType: OrderType.MARKET,
    quantity,
    clientOrderId: 'cl-1',
    correlationId: 'corr-1',
    createdAt: Date.now(),
  };
}

function makeOrder(status: OrderStatus, executedQty: number, remaining: number, avgPrice: number) {
  return {
    exchangeOrderId: 'ex-1',
    clientOrderId: 'cl-1',
    side: OrderSide.BUY,
    type: OrderType.MARKET,
    status,
    originalQuantity: 0.1,
    executedQuantity: executedQty,
    remainingQuantity: remaining,
    cumulativeQuoteQuantity: executedQty * avgPrice,
    price: avgPrice,
    averagePrice: avgPrice,
    timeInForce: TimeInForce.GTC,
    symbol: 'BTC/USDT',
    exchangeId: ExchangeId.PAPER_TRADING,
    timestamp: new Date(),
    updatedAt: new Date(),
  };
}

describe('FillProcessorService', () => {
  let service: FillProcessorService;

  beforeEach(() => {
    service = new FillProcessorService();
  });

  it('processes a full fill correctly', () => {
    const request = makeRequest(0.1);
    const order = makeOrder(OrderStatus.FILLED, 0.1, 0, 50_000);
    const fill = service.process(request, order as any);

    expect(fill.isFullFill).toBe(true);
    expect(fill.isPartialFill).toBe(false);
    expect(fill.executedQuantity).toBe(0.1);
    expect(fill.remainingQuantity).toBe(0);
    expect(fill.fillPercent).toBe(100);
    expect(fill.status).toBe(ExecutionStatus.FILLED);
    expect(fill.reportType).toBe(ExecutionReportType.ORDER_FILLED);
  });

  it('processes a partial fill correctly', () => {
    const request = makeRequest(0.1);
    const order = makeOrder(OrderStatus.PARTIALLY_FILLED, 0.05, 0.05, 50_000);
    const fill = service.process(request, order as any);

    expect(fill.isFullFill).toBe(false);
    expect(fill.isPartialFill).toBe(true);
    expect(fill.executedQuantity).toBe(0.05);
    expect(fill.remainingQuantity).toBe(0.05);
    expect(fill.fillPercent).toBeCloseTo(50);
    expect(fill.status).toBe(ExecutionStatus.PARTIALLY_FILLED);
    expect(fill.reportType).toBe(ExecutionReportType.ORDER_PARTIALLY_FILLED);
  });

  it('processes a rejected order', () => {
    const request = makeRequest(0.1);
    const order = makeOrder(OrderStatus.REJECTED, 0, 0.1, 0);
    const fill = service.process(request, order as any);

    expect(fill.isFullFill).toBe(false);
    expect(fill.isPartialFill).toBe(false);
    expect(fill.executedQuantity).toBe(0);
    expect(fill.status).toBe(ExecutionStatus.REJECTED);
    expect(fill.reportType).toBe(ExecutionReportType.ORDER_REJECTED);
  });

  it('processes a cancelled order', () => {
    const request = makeRequest(0.1);
    const order = makeOrder(OrderStatus.CANCELLED, 0, 0.1, 0);
    const fill = service.process(request, order as any);

    expect(fill.status).toBe(ExecutionStatus.CANCELLED);
    expect(fill.reportType).toBe(ExecutionReportType.ORDER_CANCELLED);
  });

  it('processes a new (open) order', () => {
    const request = makeRequest(0.1);
    const order = makeOrder(OrderStatus.NEW, 0, 0.1, 50_000);
    const fill = service.process(request, order as any);

    expect(fill.status).toBe(ExecutionStatus.OPEN);
    expect(fill.reportType).toBe(ExecutionReportType.ORDER_ACCEPTED);
  });

  it('returns fillPercent=0 for zero-quantity request', () => {
    const request = makeRequest(0);
    const order = makeOrder(OrderStatus.FILLED, 0, 0, 50_000);
    const fill = service.process(request, order as any);
    expect(fill.fillPercent).toBe(0);
  });

  it('handles large volume order', () => {
    const request = makeRequest(1_000_000);
    const order = makeOrder(OrderStatus.FILLED, 1_000_000, 0, 50_000);
    const fill = service.process(request, order as any);
    expect(fill.isFullFill).toBe(true);
    expect(fill.fillPercent).toBe(100);
  });
});
