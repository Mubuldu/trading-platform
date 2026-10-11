import { OrderTrackerService } from '../../../src/modules/execution/application/services/order-tracker.service';
import { ExecutionStatus } from '../../../src/modules/execution/domain/enums/execution-status.enum';
import { ExchangeId } from '../../../src/modules/exchange/enums/exchange.enums';
import {
  OrderSide,
  OrderType,
  OrderStatus,
  TimeInForce,
} from '../../../src/modules/exchange/enums/order.enums';
import { ExecutionRequestModel } from '../../../src/modules/execution/domain/models/execution-request.model';

function makeRequest(id = 'req-1'): ExecutionRequestModel {
  return {
    requestId: id,
    decisionId: 'd-1',
    strategyId: 'strat-1',
    signalId: 'sig-1',
    exchangeId: ExchangeId.PAPER_TRADING,
    symbol: 'BTC/USDT',
    side: OrderSide.BUY,
    orderType: OrderType.MARKET,
    quantity: 0.1,
    clientOrderId: 'cl-1',
    correlationId: 'corr-1',
    createdAt: Date.now(),
  };
}

function makeOrder(status: OrderStatus) {
  return {
    exchangeOrderId: 'ex-1',
    clientOrderId: 'cl-1',
    side: OrderSide.BUY,
    type: OrderType.MARKET,
    status,
    originalQuantity: 0.1,
    executedQuantity: status === OrderStatus.FILLED ? 0.1 : 0,
    remainingQuantity: status === OrderStatus.FILLED ? 0 : 0.1,
    cumulativeQuoteQuantity: 5000,
    price: 0,
    averagePrice: 50_000,
    timeInForce: TimeInForce.GTC,
    symbol: 'BTC/USDT',
    exchangeId: ExchangeId.PAPER_TRADING,
    timestamp: new Date(),
    updatedAt: new Date(),
  };
}

describe('OrderTrackerService', () => {
  let service: OrderTrackerService;

  beforeEach(() => {
    service = new OrderTrackerService();
  });

  it('starts a new order in PENDING status', () => {
    const req = makeRequest();
    service.start(req.requestId, req);
    const state = service.get(req.requestId);
    expect(state).toBeDefined();
    expect(state!.status).toBe(ExecutionStatus.PENDING);
  });

  it('marks order as SUBMITTED', () => {
    const req = makeRequest();
    service.start(req.requestId, req);
    service.markSubmitted(req.requestId);
    expect(service.get(req.requestId)!.status).toBe(ExecutionStatus.SUBMITTED);
  });

  it('updates status to FILLED when order is filled', () => {
    const req = makeRequest();
    service.start(req.requestId, req);
    service.update(req.requestId, makeOrder(OrderStatus.FILLED) as any);
    expect(service.get(req.requestId)!.status).toBe(ExecutionStatus.FILLED);
  });

  it('updates status to PARTIALLY_FILLED', () => {
    const req = makeRequest();
    service.start(req.requestId, req);
    service.update(req.requestId, makeOrder(OrderStatus.PARTIALLY_FILLED) as any);
    expect(service.get(req.requestId)!.status).toBe(ExecutionStatus.PARTIALLY_FILLED);
  });

  it('records error message when marking as FAILED', () => {
    const req = makeRequest();
    service.start(req.requestId, req);
    service.fail(req.requestId, 'network error');
    const state = service.get(req.requestId);
    expect(state!.status).toBe(ExecutionStatus.FAILED);
    expect(state!.errorMessage).toBe('network error');
  });

  it('returns undefined for unknown requestId', () => {
    expect(service.get('nonexistent')).toBeUndefined();
  });

  it('getActive() excludes terminal orders', () => {
    const r1 = makeRequest('req-1');
    const r2 = makeRequest('req-2');
    const r3 = makeRequest('req-3');
    service.start(r1.requestId, r1);
    service.start(r2.requestId, r2);
    service.start(r3.requestId, r3);
    service.update(r1.requestId, makeOrder(OrderStatus.FILLED) as any);
    service.fail(r2.requestId, 'error');

    const active = service.getActive();
    expect(active).toHaveLength(1);
    expect(active[0].requestId).toBe('req-3');
  });

  it('getAll() returns all orders regardless of status', () => {
    service.start('req-1', makeRequest('req-1'));
    service.start('req-2', makeRequest('req-2'));
    service.update('req-1', makeOrder(OrderStatus.FILLED) as any);
    expect(service.getAll()).toHaveLength(2);
  });

  it('ignores update/fail calls for unknown requestId', () => {
    expect(() => service.update('unknown', makeOrder(OrderStatus.FILLED) as any)).not.toThrow();
    expect(() => service.fail('unknown', 'err')).not.toThrow();
  });
});
