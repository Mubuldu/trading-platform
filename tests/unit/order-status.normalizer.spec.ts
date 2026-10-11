import { OrderStatusNormalizer } from '@modules/exchange/normalizers/order-status.normalizer';
import { OrderStatus } from '@modules/exchange/enums/order.enums';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';

describe('OrderStatusNormalizer', () => {
  let normalizer: OrderStatusNormalizer;

  const binanceMappings: Record<string, OrderStatus> = {
    NEW: OrderStatus.NEW,
    PARTIALLY_FILLED: OrderStatus.PARTIALLY_FILLED,
    FILLED: OrderStatus.FILLED,
    CANCELED: OrderStatus.CANCELLED,
    REJECTED: OrderStatus.REJECTED,
    EXPIRED: OrderStatus.EXPIRED,
    PENDING_CANCEL: OrderStatus.PENDING_CANCEL,
  };

  const bybitMappings: Record<string, OrderStatus> = {
    Created: OrderStatus.NEW,
    New: OrderStatus.NEW,
    PartiallyFilled: OrderStatus.PARTIALLY_FILLED,
    Filled: OrderStatus.FILLED,
    Cancelled: OrderStatus.CANCELLED,
    Rejected: OrderStatus.REJECTED,
    Expired: OrderStatus.EXPIRED,
  };

  beforeEach(() => {
    normalizer = new OrderStatusNormalizer();
    normalizer.registerMappings(ExchangeId.BINANCE_SPOT, binanceMappings);
    normalizer.registerMappings(ExchangeId.BYBIT_SPOT, bybitMappings);
  });

  describe('normalize()', () => {
    it('normalizes Binance FILLED', () => {
      expect(normalizer.normalize('FILLED', ExchangeId.BINANCE_SPOT)).toBe(OrderStatus.FILLED);
    });

    it('normalizes Binance CANCELED (misspelled — single L)', () => {
      expect(normalizer.normalize('CANCELED', ExchangeId.BINANCE_SPOT)).toBe(OrderStatus.CANCELLED);
    });

    it('normalizes Bybit PartiallyFilled', () => {
      expect(normalizer.normalize('PartiallyFilled', ExchangeId.BYBIT_SPOT)).toBe(
        OrderStatus.PARTIALLY_FILLED,
      );
    });

    it('normalizes Bybit case-insensitively', () => {
      expect(normalizer.normalize('partiallyFilled', ExchangeId.BYBIT_SPOT)).toBe(
        OrderStatus.PARTIALLY_FILLED,
      );
    });

    it('uses fallback for unknown exchange and known enum value', () => {
      const result = normalizer.normalize('FILLED', ExchangeId.OKX_SPOT);
      expect(result).toBe(OrderStatus.FILLED);
    });

    it('uses fallback for unknown status string — returns UNKNOWN', () => {
      const result = normalizer.normalize('SOME_FUTURE_STATUS', ExchangeId.BINANCE_SPOT);
      expect(result).toBe(OrderStatus.UNKNOWN);
    });
  });

  describe('hasMapping()', () => {
    it('returns true for registered exchange', () => {
      expect(normalizer.hasMapping(ExchangeId.BINANCE_SPOT)).toBe(true);
    });

    it('returns false for unregistered exchange', () => {
      expect(normalizer.hasMapping(ExchangeId.OKX_SPOT)).toBe(false);
    });
  });
});
