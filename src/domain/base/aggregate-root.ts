import { Entity } from './entity';
import { DomainEvent } from './domain-event';

/**
 * AggregateRoot is an Entity that acts as the consistency boundary for a
 * cluster of related objects.
 *
 * Rules:
 *  - Only the AggregateRoot can be retrieved from a Repository
 *  - External code may only hold a reference to the root, not internal entities
 *  - All changes to internal state must flow through root methods
 *  - Domain events are accumulated on the root and dispatched after the
 *    repository commits the transaction
 *
 * The version field supports optimistic concurrency control: before saving,
 * the repository checks that the version in the store matches. If another
 * write has incremented the version since we loaded, the save fails.
 */
export abstract class AggregateRoot<TId> extends Entity<TId> {
  private readonly _domainEvents: DomainEvent[] = [];
  private _version = 0;

  get domainEvents(): ReadonlyArray<DomainEvent> {
    return [...this._domainEvents];
  }

  get version(): number {
    return this._version;
  }

  protected addDomainEvent(event: DomainEvent): void {
    this._domainEvents.push(event);
  }

  clearDomainEvents(): DomainEvent[] {
    const events = [...this._domainEvents];
    this._domainEvents.length = 0;
    return events;
  }

  protected incrementVersion(): void {
    this._version++;
  }
}
