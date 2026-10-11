import { Specification } from '@domain/base/specification';
import { BusinessRuleViolationError } from '@domain/errors/domain.error';

interface Order {
  quantity: number;
  price: number;
  side: 'buy' | 'sell';
}

class PositiveQuantitySpec extends Specification<Order> {
  isSatisfiedBy(order: Order): boolean {
    return order.quantity > 0;
  }
}

class PositivePriceSpec extends Specification<Order> {
  isSatisfiedBy(order: Order): boolean {
    return order.price > 0;
  }
}

class BuyOrderSpec extends Specification<Order> {
  isSatisfiedBy(order: Order): boolean {
    return order.side === 'buy';
  }
}

const validOrder: Order = { quantity: 10, price: 100, side: 'buy' };

describe('Specification', () => {
  describe('isSatisfiedBy()', () => {
    it('returns true when satisfied', () => {
      const spec = new PositiveQuantitySpec();
      expect(spec.isSatisfiedBy(validOrder)).toBe(true);
    });

    it('returns false when not satisfied', () => {
      const spec = new PositiveQuantitySpec();
      expect(spec.isSatisfiedBy({ ...validOrder, quantity: -1 })).toBe(false);
    });
  });

  describe('and()', () => {
    it('satisfied only when both are satisfied', () => {
      const spec = new PositiveQuantitySpec().and(new PositivePriceSpec());
      expect(spec.isSatisfiedBy(validOrder)).toBe(true);
      expect(spec.isSatisfiedBy({ ...validOrder, quantity: -1 })).toBe(false);
      expect(spec.isSatisfiedBy({ ...validOrder, price: -1 })).toBe(false);
    });
  });

  describe('or()', () => {
    it('satisfied when at least one is satisfied', () => {
      const spec = new BuyOrderSpec().or(new PositivePriceSpec());
      expect(spec.isSatisfiedBy({ ...validOrder, side: 'sell', price: 0 })).toBe(false);
      expect(spec.isSatisfiedBy({ ...validOrder, side: 'sell' })).toBe(true);
      expect(spec.isSatisfiedBy(validOrder)).toBe(true);
    });
  });

  describe('not()', () => {
    it('inverts the result', () => {
      const spec = new BuyOrderSpec().not();
      expect(spec.isSatisfiedBy(validOrder)).toBe(false);
      expect(spec.isSatisfiedBy({ ...validOrder, side: 'sell' })).toBe(true);
    });
  });

  describe('toResult()', () => {
    it('returns Ok when satisfied', () => {
      const spec = new PositiveQuantitySpec();
      const r = spec.toResult(validOrder, () => new BusinessRuleViolationError('invalid quantity'));
      expect(r.isOk()).toBe(true);
    });

    it('returns Err when not satisfied', () => {
      const spec = new PositiveQuantitySpec();
      const invalidOrder = { ...validOrder, quantity: 0 };
      const r = spec.toResult(
        invalidOrder,
        () => new BusinessRuleViolationError('invalid quantity'),
      );
      expect(r.isErr()).toBe(true);
      if (r.isErr()) {
        expect(r.error).toBeInstanceOf(BusinessRuleViolationError);
      }
    });
  });

  describe('composition', () => {
    it('chains and().not() correctly', () => {
      const notBuySpec = new BuyOrderSpec().not();
      const spec = new PositiveQuantitySpec().and(notBuySpec);
      const sellOrder: Order = { quantity: 10, price: 100, side: 'sell' };
      expect(spec.isSatisfiedBy(sellOrder)).toBe(true);
      expect(spec.isSatisfiedBy(validOrder)).toBe(false);
    });
  });
});
