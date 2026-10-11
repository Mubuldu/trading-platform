import { Result, ok, err } from '@common/result';
import { BaseError } from '@common/errors/base.error';

/**
 * Specification encodes a single business rule as a first-class object.
 *
 * Specifications are:
 *  - Composable via and(), or(), not()
 *  - Reusable across use cases
 *  - Testable in isolation
 *  - Expressible as a Result (toResult) for integration with the Result pattern
 *
 * Usage:
 *   const validOrder = new OrderNotExpiredSpec().and(new SufficientMarginSpec());
 *   if (!validOrder.isSatisfiedBy(order)) { ... }
 *
 * When NOT to use Specification:
 *  - Simple one-off conditions that will never be reused
 *  - Conditions that require async data loading — use a domain service instead
 */
export abstract class Specification<T> {
  abstract isSatisfiedBy(candidate: T): boolean;

  and(other: Specification<T>): Specification<T> {
    return new AndSpecification(this, other);
  }

  or(other: Specification<T>): Specification<T> {
    return new OrSpecification(this, other);
  }

  not(): Specification<T> {
    return new NotSpecification(this);
  }

  toResult<E extends BaseError>(candidate: T, errorFn: () => E): Result<T, E> {
    return this.isSatisfiedBy(candidate) ? ok(candidate) : err(errorFn());
  }
}

class AndSpecification<T> extends Specification<T> {
  constructor(
    private readonly left: Specification<T>,
    private readonly right: Specification<T>,
  ) {
    super();
  }

  isSatisfiedBy(candidate: T): boolean {
    return this.left.isSatisfiedBy(candidate) && this.right.isSatisfiedBy(candidate);
  }
}

class OrSpecification<T> extends Specification<T> {
  constructor(
    private readonly left: Specification<T>,
    private readonly right: Specification<T>,
  ) {
    super();
  }

  isSatisfiedBy(candidate: T): boolean {
    return this.left.isSatisfiedBy(candidate) || this.right.isSatisfiedBy(candidate);
  }
}

class NotSpecification<T> extends Specification<T> {
  constructor(private readonly inner: Specification<T>) {
    super();
  }

  isSatisfiedBy(candidate: T): boolean {
    return !this.inner.isSatisfiedBy(candidate);
  }
}
