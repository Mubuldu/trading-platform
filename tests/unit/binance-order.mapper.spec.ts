import { BinanceOrderMapper } from '@modules/exchange/adapters/binance/mappers/binance-order.mapper';
import { BinanceRawOrder } from '@modules/exchange/adapters/binance/client/binance-http.types';
import { OrderStatusNormalizer } from '@modules/exchange/normalizers/order-status.normalizer';
import {
  OrderStatus,
  OrderSide,
  OrderType,
  TimeInForce,
} from '@modules/exchange/enums/order.enums';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';

const BINANCE_STATUS_MAP: Record<string, OrderStatus> = {
  NEW: OrderStatus.NEW,
  PARTIALLY_FILLED: OrderStatus.PARTIALLY_FILLED,
  FILLED: OrderStatus.FILLED,
  CANCELED: OrderStatus.CANCELLED,
  PENDING_CANCEL: OrderStatus.PENDING_CANCEL,
  REJECTED: OrderStatus.REJECTED,
  EXPIRED: OrderStatus.EXPIRED,
  EXPIRED_IN_MATCH: OrderStatus.EXPIRED,
};

const BASE_ORDER: BinanceRawOrder = {
  symbol: 'BTCUSDT',
  orderId: 12345,
  orderListId: -1,
  clientOrderId: 'myOrder001',
  price: '50000.00',
  origQty: '0.001',
  executedQty: '0.000',
  cummulativeQuoteQty: '0.00000000',
  status: 'NEW',
  timeInForce: 'GTC',
  type: 'LIMIT',
  side: 'BUY',
  time: 1700000000000,
  updateTime: 1700000001000,
  isWorking: true,
  workingTime: 1700000000000,
  origQuoteOrderQty: '50.00000000',
};

describe('BinanceOrderMapper', () => {
  let mapper: BinanceOrderMapper;
  let statusNormalizer: OrderStatusNormalizer;
  const receivedAt = new Date('2024-01-01T00:00:00Z');

  beforeEach(() => {
    statusNormalizer = new OrderStatusNormalizer();
    statusNormalizer.registerMappings(ExchangeId.BINANCE_SPOT, BINANCE_STATUS_MAP);
    mapper = new BinanceOrderMapper(statusNormalizer);
  });

  describe('map()', () => {
    it('maps a NEW limit order correctly', () => {
      const result = mapper.map(BASE_ORDER, receivedAt);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const order = result.value;
        expect(order.exchangeOrderId).toBe('12345');
        expect(order.clientOrderId).toBe('myOrder001');
        expect(order.side).toBe(OrderSide.BUY);
        expect(order.type).toBe(OrderType.LIMIT);
        expect(order.status).toBe(OrderStatus.NEW);
        expect(order.timeInForce).toBe(TimeInForce.GTC);
        expect(order.originalQuantity).toBe(0.001);
        expect(order.executedQuantity).toBe(0);
        expect(order.remainingQuantity).toBe(0.001);
        expect(order.price).toBe(50000);
        expect(order.averagePrice).toBe(0);
      }
    });

    it('computes averagePrice from executedQty and cummulativeQuoteQty', () => {
      const raw: BinanceRawOrder = {
        ...BASE_ORDER,
        executedQty: '0.001',
        cummulativeQuoteQty: '50.00000000',
        status: 'FILLED',
      };
      const result = mapper.map(raw, receivedAt);
      if (result.isOk()) {
        expect(result.value.averagePrice).toBeCloseTo(50000, 2);
        expect(result.value.status).toBe(OrderStatus.FILLED);
      }
    });

    it('sets averagePrice to 0 when no fills', () => {
      const result = mapper.map(BASE_ORDER, receivedAt);
      if (result.isOk()) {
        expect(result.value.averagePrice).toBe(0);
      }
    });

    it('maps SELL side correctly', () => {
      const raw: BinanceRawOrder = { ...BASE_ORDER, side: 'SELL' };
      const result = mapper.map(raw, receivedAt);
      if (result.isOk()) {
        expect(result.value.side).toBe(OrderSide.SELL);
      }
    });

    it('maps MARKET order type correctly', () => {
      const raw: BinanceRawOrder = {
        ...BASE_ORDER,
        type: 'MARKET',
        price: '0.00000000',
        timeInForce: 'GTC',
      };
      const result = mapper.map(raw, receivedAt);
      if (result.isOk()) {
        expect(result.value.type).toBe(OrderType.MARKET);
      }
    });

    it('maps LIMIT_MAKER as LIMIT with postOnly=true', () => {
      const raw: BinanceRawOrder = { ...BASE_ORDER, type: 'LIMIT_MAKER' };
      const result = mapper.map(raw, receivedAt);
      if (result.isOk()) {
        expect(result.value.type).toBe(OrderType.LIMIT);
        expect(result.value.postOnly).toBe(true);
      }
    });

    it('normalizes Binance CANCELED (single L) to CANCELLED', () => {
      const raw: BinanceRawOrder = { ...BASE_ORDER, status: 'CANCELED' };
      const result = mapper.map(raw, receivedAt);
      if (result.isOk()) {
        expect(result.value.status).toBe(OrderStatus.CANCELLED);
      }
    });

    it('maps stopPrice when non-zero', () => {
      const raw: BinanceRawOrder = { ...BASE_ORDER, stopPrice: '49000.00' };
      const result = mapper.map(raw, receivedAt);
      if (result.isOk()) {
        expect(result.value.stopPrice).toBe(49000);
      }
    });

    it('omits stopPrice when it is 0.00000000', () => {
      const raw: BinanceRawOrder = { ...BASE_ORDER, stopPrice: '0.00000000' };
      const result = mapper.map(raw, receivedAt);
      if (result.isOk()) {
        expect(result.value.stopPrice).toBeUndefined();
      }
    });

    it('sets timestamp from Binance time field', () => {
      const result = mapper.map(BASE_ORDER, receivedAt);
      if (result.isOk()) {
        expect(result.value.timestamp).toEqual(new Date(1700000000000));
      }
    });

    it('sets updatedAt from Binance updateTime field', () => {
      const result = mapper.map(BASE_ORDER, receivedAt);
      if (result.isOk()) {
        expect(result.value.updatedAt).toEqual(new Date(1700000001000));
      }
    });
  });

  describe('mapMany()', () => {
    it('maps an array of orders', () => {
      const orders = [BASE_ORDER, { ...BASE_ORDER, orderId: 99999 }];
      const result = mapper.mapMany(orders, receivedAt);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
      }
    });

    it('returns empty array for empty input', () => {
      const result = mapper.mapMany([], receivedAt);
      if (result.isOk()) {
        expect(result.value).toHaveLength(0);
      }
    });
  });

  describe('remainingQuantity calculation', () => {
    it('remainingQuantity = origQty - executedQty', () => {
      const raw: BinanceRawOrder = {
        ...BASE_ORDER,
        origQty: '1.000',
        executedQty: '0.600',
        cummulativeQuoteQty: '30000.00',
        status: 'PARTIALLY_FILLED',
      };
      const result = mapper.map(raw, receivedAt);
      if (result.isOk()) {
        expect(result.value.remainingQuantity).toBeCloseTo(0.4, 3);
        expect(result.value.status).toBe(OrderStatus.PARTIALLY_FILLED);
      }
    });

    it('remainingQuantity is 0 for FILLED orders', () => {
      const raw: BinanceRawOrder = {
        ...BASE_ORDER,
        origQty: '0.001',
        executedQty: '0.001',
        cummulativeQuoteQty: '50.00',
        status: 'FILLED',
      };
      const result = mapper.map(raw, receivedAt);
      if (result.isOk()) {
        expect(result.value.remainingQuantity).toBe(0);
      }
    });
  });
});
