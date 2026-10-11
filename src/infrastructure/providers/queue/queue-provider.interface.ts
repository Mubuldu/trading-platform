import { Result } from '@common/result';
import { InfrastructureError } from '@common/errors/infrastructure.error';
import { HealthCheckable } from '@infrastructure/health/health-check.interface';

export interface EnqueueOptions {
  delayMs?: number;
  priority?: number;
  ttlMs?: number;
  deduplicationKey?: string;
}

export interface ConsumeOptions {
  concurrency?: number;
  visibilityTimeoutMs?: number;
}

export interface QueueMessage<T> {
  readonly messageId: string;
  readonly payload: T;
  readonly enqueuedAt: Date;
  readonly attempts: number;
  acknowledge(): Promise<void>;
  reject(requeue?: boolean): Promise<void>;
}

export type MessageHandler<T> = (message: QueueMessage<T>) => Promise<void>;

/**
 * QueueProvider abstracts async task queuing for work that should be
 * processed outside the request/response cycle.
 *
 * Use for: order confirmation emails, risk recalculation after fills,
 * position reconciliation, end-of-day reporting.
 *
 * Do NOT use for: real-time market data (use WebSocket), synchronous
 * domain operations (use domain services directly).
 *
 * The in-memory implementation does not persist messages across restarts.
 * Use RabbitMQ, BullMQ (Redis-backed), or AWS SQS for production.
 */
export interface QueueProvider extends HealthCheckable {
  enqueue<T>(
    queueName: string,
    payload: T,
    options?: EnqueueOptions,
  ): Promise<Result<string, InfrastructureError>>;
  consume<T>(
    queueName: string,
    handler: MessageHandler<T>,
    options?: ConsumeOptions,
  ): Promise<Result<() => Promise<void>, InfrastructureError>>;
  getQueueDepth(queueName: string): Promise<Result<number, InfrastructureError>>;
  purge(queueName: string): Promise<Result<void, InfrastructureError>>;
  getProviderName(): string;
}
