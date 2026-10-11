/**
 * Entity is an object defined by its identity, not its attributes.
 *
 * Two entities with the same ID are the same entity even if all other
 * properties differ. This is in contrast to ValueObject, where equality
 * is structural (all props equal).
 *
 * Guidelines:
 *  - Never use primitives as IDs in the domain — wrap them in a typed alias
 *    or value object (e.g. OrderId, UserId) to prevent ID mixup bugs.
 *  - Entity state mutation should always go through domain methods, not
 *    direct property assignment.
 */
export abstract class Entity<TId> {
  protected constructor(private readonly _id: TId) {}

  get id(): TId {
    return this._id;
  }

  equals(other: Entity<TId>): boolean {
    if (!(other instanceof Entity)) return false;
    if (this.constructor !== other.constructor) return false;
    return this._id === other._id;
  }

  hashCode(): string {
    return `${this.constructor.name}:${String(this._id)}`;
  }
}
