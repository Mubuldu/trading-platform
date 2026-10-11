import { Result } from '@common/result';
import { InfrastructureError } from '@common/errors/infrastructure.error';
import { DomainEvent } from '@domain/base/domain-event';
import { HealthCheckable } from '@infrastructure/health/health-check.interface';

export type EventHandler<T extends DomainEvent = DomainEvent> = (event: T) => Promise<void>;
export type Unsubscribe = () => void;

export interface EventSubscription {
  readonly eventType: string;
  readonly subscriptionId: string;
  unsubscribe(): void;
}

/**
 * EventBusProvider is the publish/subscribe backbone for domain events.
 *
 * Domain events are published after an aggregate operation completes and
 * the transaction commits. Subscribers react to events without being coupled
 * to the publisher's module.
 *
 * The in-memory implementation is used in development and testing.
 * Production uses a durable message broker (RabbitMQ, Kafka, AWS SNS/SQS).
 * Events published to an in-memory bus are lost on process restart.
 *
 * Handler errors: each handler is invoked independently. A failing handler
 * does not prevent other handlers from running. Errors are logged but not
 * re-thrown to the publisher — the publish() call always succeeds if the
 * broker accepted the message.
 */
export interface EventBusProvider extends HealthCheckable {
  publish(event: DomainEvent): Promise<Result<void, InfrastructureError>>;
  publishBatch(events: DomainEvent[]): Promise<Result<void, InfrastructureError>>;
  subscribe<T extends DomainEvent>(eventType: string, handler: EventHandler<T>): EventSubscription;
  getProviderName(): string;
}
