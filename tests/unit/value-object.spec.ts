import { ValueObject } from '@domain/base/value-object';
import { Result, ok, err } from '@common/result';
import { DomainValidationError } from '@domain/errors/domain.error';

interface PriceProps {
  value: number;
  currency: string;
}

class Price extends ValueObject<PriceProps> {
  private constructor(props: PriceProps) {
    super(props);
  }

  static create(value: number, currency: string): Result<Price, DomainValidationError> {
    const p = new Price({ value, currency });
    return p.validate();
  }

  validate(): Result<this, DomainValidationError> {
    if (this.props.value <= 0) {
      return err(new DomainValidationError('Price must be positive'));
    }
    if (!this.props.currency || this.props.currency.length !== 3) {
      return err(new DomainValidationError('Currency must be 3 chars'));
    }
    return ok(this);
  }

  get value(): number {
    return this.props.value;
  }
  get currency(): string {
    return this.props.currency;
  }
}

class Price2 extends ValueObject<PriceProps> {
  static make(value: number, currency: string): Price2 {
    return new Price2({ value, currency });
  }

  validate(): Result<this, DomainValidationError> {
    return ok(this);
  }
}

describe('ValueObject', () => {
  it('creates a valid value object', () => {
    const r = Price.create(100, 'USD');
    expect(r.isOk()).toBe(true);
  });

  it('returns error for non-positive price', () => {
    const r = Price.create(-1, 'USD');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBeInstanceOf(DomainValidationError);
    }
  });

  it('returns error for invalid currency', () => {
    const r = Price.create(100, 'INVALID');
    expect(r.isErr()).toBe(true);
  });

  it('two value objects with same props are equal', () => {
    const a = Price.create(100, 'USD').getOrThrow();
    const b = Price.create(100, 'USD').getOrThrow();
    expect(a.equals(b)).toBe(true);
  });

  it('two value objects with different value are not equal', () => {
    const a = Price.create(100, 'USD').getOrThrow();
    const b = Price.create(200, 'USD').getOrThrow();
    expect(a.equals(b)).toBe(false);
  });

  it('two value objects of different classes are not equal', () => {
    const a = Price.create(100, 'USD').getOrThrow();
    const b = Price2.make(100, 'USD');
    expect(a.equals(b)).toBe(false);
  });

  it('props are frozen (immutable)', () => {
    const p = Price.create(100, 'USD').getOrThrow();
    expect(Object.isFrozen((p as unknown as { props: object }).props)).toBe(true);
  });

  it('accessing props returns correct values', () => {
    const p = Price.create(150.5, 'EUR').getOrThrow();
    expect(p.value).toBe(150.5);
    expect(p.currency).toBe('EUR');
  });
});
