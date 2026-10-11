import { randomUUID } from 'crypto';

/**
 * DomainEvent records something significant that happened in the domain.
 *
 * Events are:
 *  - Immutable — they record history, not current state
 *  - Named in past tense (OrderPlaced, PositionOpened, RiskLimitBreached)
 *  - Produced inside aggregate methods, not outside them
 *  - Collected on the AggregateRoot, then dispatched after the transaction commits
 *
 * The occurredAt parameter is optional so tests can inject a specific time.
 * In production code, omit it and let the event record the real current time.
 *
 * Using randomUUID() for eventId is appropriate here — we don't need
 * injectable ID generation for events because the ID is for deduplication
 * and correlation only, not for business logic.
 */
export abstract class DomainEvent {
  readonly eventId: string;
  readonly occurredAt: Date;
  abstract readonly eventType: string;
  abstract readonly aggregateId: string;
  abstract readonly aggregateVersion: number;

  protected constructor(occurredAt?: Date) {
    this.eventId = randomUUID();
    this.occurredAt = occurredAt ?? new Date();
  }
}
