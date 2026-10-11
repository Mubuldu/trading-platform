import { Result } from '@common/result';
import { DomainValidationError } from '@domain/errors/domain.error';

/**
 * ValueObject is an object defined by its attributes, not its identity.
 *
 * Two value objects with identical properties are considered equal regardless
 * of reference. They are always immutable — once constructed, properties
 * cannot change. To "change" a value object, create a new instance.
 *
 * In a trading platform, canonical value objects include:
 *  Price, Quantity, Symbol, Currency, Percentage, MoneyAmount, OrderSide, etc.
 *
 * The subclass constructor must call validate() and either throw or return an
 * error if the props are invalid. Use the static factory pattern to surface
 * this through the Result type:
 *
 *   class Price extends ValueObject<PriceProps> {
 *     static create(value: number): Result<Price> {
 *       const price = new Price({ value });
 *       return price.validate();
 *     }
 *   }
 *
 * Never expose the constructor directly when validation can fail.
 */
export abstract class ValueObject<T extends object> {
  protected readonly props: Readonly<T>;

  protected constructor(props: T) {
    this.props = Object.freeze({ ...props });
  }

  abstract validate(): Result<this, DomainValidationError>;

  equals(other: ValueObject<T>): boolean {
    if (this.constructor !== other.constructor) return false;
    return JSON.stringify(this.props) === JSON.stringify(other.props);
  }

  toString(): string {
    return JSON.stringify(this.props);
  }
}
