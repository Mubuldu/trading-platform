/**
 * IdGenerator abstracts ID generation so tests can inject deterministic IDs
 * instead of random UUIDs.
 *
 * Every aggregate root and domain event that needs an ID should accept an
 * IdGenerator rather than calling crypto.randomUUID() directly.
 */
export interface IdGenerator {
  generate(): string;
}
