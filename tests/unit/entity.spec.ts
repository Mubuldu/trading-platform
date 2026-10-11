import { Entity } from '@domain/base/entity';
import { AggregateRoot } from '@domain/base/aggregate-root';
import { DomainEvent } from '@domain/base/domain-event';

class UserId {
  constructor(readonly value: string) {}
}

class User extends Entity<UserId> {
  constructor(
    id: UserId,
    public readonly name: string,
  ) {
    super(id);
  }
}

class OrderId {
  constructor(readonly value: string) {}
}

class UserRegisteredEvent extends DomainEvent {
  readonly eventType = 'UserRegistered';
  readonly aggregateId: string;
  readonly aggregateVersion: number;

  constructor(userId: string, version: number) {
    super();
    this.aggregateId = userId;
    this.aggregateVersion = version;
  }
}

class OrderAggregate extends AggregateRoot<OrderId> {
  private _status = 'pending';

  constructor(id: OrderId) {
    super(id);
  }

  get status(): string {
    return this._status;
  }

  fill(): void {
    this._status = 'filled';
    this.incrementVersion();
    this.addDomainEvent(new UserRegisteredEvent(this.id.value, this.version));
  }
}

describe('Entity', () => {
  it('equals() returns true for same id and type', () => {
    const id = new UserId('abc');
    const u1 = new User(id, 'Alice');
    const u2 = new User(id, 'Bob');
    expect(u1.equals(u2)).toBe(true);
  });

  it('equals() returns false for different ids', () => {
    const u1 = new User(new UserId('1'), 'Alice');
    const u2 = new User(new UserId('2'), 'Alice');
    expect(u1.equals(u2)).toBe(false);
  });

  it('hashCode() includes class name and id', () => {
    const u = new User(new UserId('x'), 'A');
    expect(u.hashCode()).toContain('User');
  });
});

describe('AggregateRoot', () => {
  it('starts with empty domainEvents', () => {
    const order = new OrderAggregate(new OrderId('o1'));
    expect(order.domainEvents).toHaveLength(0);
  });

  it('accumulates domain events', () => {
    const order = new OrderAggregate(new OrderId('o1'));
    order.fill();
    expect(order.domainEvents).toHaveLength(1);
    expect(order.domainEvents[0].eventType).toBe('UserRegistered');
  });

  it('clearDomainEvents returns and clears events', () => {
    const order = new OrderAggregate(new OrderId('o1'));
    order.fill();
    const events = order.clearDomainEvents();
    expect(events).toHaveLength(1);
    expect(order.domainEvents).toHaveLength(0);
  });

  it('increments version on state change', () => {
    const order = new OrderAggregate(new OrderId('o1'));
    expect(order.version).toBe(0);
    order.fill();
    expect(order.version).toBe(1);
  });

  it('domain events list is a copy (not the internal array)', () => {
    const order = new OrderAggregate(new OrderId('o1'));
    order.fill();
    const events = order.domainEvents;
    (events as DomainEvent[]).push(new UserRegisteredEvent('x', 2));
    expect(order.domainEvents).toHaveLength(1);
  });
});
