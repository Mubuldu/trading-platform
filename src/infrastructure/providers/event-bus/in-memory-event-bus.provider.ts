import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ok } from '@common/result';
import { DomainEvent } from '@domain/base/domain-event';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { healthyResult, ProviderHealth } from '@infrastructure/health/health-check.interface';
import { EventBusProvider, EventHandler, EventSubscription } from './event-bus.interface';

interface HandlerEntry {
  subscriptionId: string;
  handler: EventHandler;
}

/**
 * InMemoryEventBusProvider delivers domain events synchronously within the
 * same process using a handler registry.
 *
 * Each event type has a set of registered handlers. When publish() is called,
 * all handlers for that event type are invoked concurrently via Promise.all.
 * Handler errors are caught and logged — they never propagate to the publisher.
 *
 * This design guarantees:
 *  - The publisher always gets an Ok result (event accepted)
 *  - A misbehaving handler cannot prevent other handlers from running
 *  - The publisher does not need to know about consumers
 *
 * Limitation: events are NOT durable. A handler crash or process restart
 * loses any in-flight or unprocessed events.
 *
 * Replace with a durable broker (RabbitMQ, Kafka) for production.
 */
@Injectable()
export class InMemoryEventBusProvider implements EventBusProvider {
  private readonly context = InMemoryEventBusProvider.name;
  private readonly handlers = new Map<string, Set<HandlerEntry>>();
  private publishedCount = 0;

  constructor(private readonly logger: AppLoggerService) {}

  async publish(event: DomainEvent): ReturnType<EventBusProvider['publish']> {
    this.publishedCount++;
    const entries = this.handlers.get(event.eventType);

    if (!entries || entries.size === 0) {
      this.logger.debug(
        `No handlers for event "${event.eventType}" [${event.eventId}]`,
        this.context,
      );
      return ok(undefined);
    }

    await Promise.all(
      [...entries].map(({ subscriptionId, handler }) =>
        handler(event).catch((error: unknown) => {
          this.logger.error(
            `Handler "${subscriptionId}" failed for event "${event.eventType}": ${
              error instanceof Error ? error.message : String(error)
            }`,
            error instanceof Error ? error.stack : undefined,
            this.context,
          );
        }),
      ),
    );

    return ok(undefined);
  }

  async publishBatch(events: DomainEvent[]): ReturnType<EventBusProvider['publishBatch']> {
    for (const event of events) {
      await this.publish(event);
    }
    return ok(undefined);
  }

  subscribe<T extends DomainEvent>(eventType: string, handler: EventHandler<T>): EventSubscription {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }

    const subscriptionId = randomUUID();
    const entry: HandlerEntry = { subscriptionId, handler: handler as EventHandler };
    this.handlers.get(eventType)!.add(entry);

    this.logger.debug(
      `Subscribed to "${eventType}" [subscription: ${subscriptionId}]`,
      this.context,
    );

    return {
      eventType,
      subscriptionId,
      unsubscribe: (): void => {
        this.handlers.get(eventType)?.delete(entry);
        this.logger.debug(`Unsubscribed from "${eventType}" [${subscriptionId}]`, this.context);
      },
    };
  }

  getProviderName(): string {
    return 'in-memory-event-bus';
  }

  async getHealth(): Promise<ProviderHealth> {
    const subscriberCount = [...this.handlers.values()].reduce((sum, s) => sum + s.size, 0);
    return healthyResult(
      `in-memory-event-bus — ${this.handlers.size} event types, ${subscriberCount} subscribers, ${this.publishedCount} published`,
    );
  }
}
