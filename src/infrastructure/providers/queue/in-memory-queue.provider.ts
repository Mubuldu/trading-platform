import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ok, err } from '@common/result';
import { ServiceUnavailableError } from '@common/errors/infrastructure.error';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { healthyResult, ProviderHealth } from '@infrastructure/health/health-check.interface';
import {
  QueueProvider,
  QueueMessage,
  MessageHandler,
  EnqueueOptions,
  ConsumeOptions,
} from './queue-provider.interface';

interface BufferedMessage<T> {
  messageId: string;
  payload: T;
  enqueuedAt: Date;
  attempts: number;
}

const MAX_BUFFER = 10_000;

/**
 * InMemoryQueueProvider delivers messages within the same process.
 *
 * Messages enqueued before a consumer subscribes are buffered (up to
 * MAX_BUFFER per queue). Overflow drops the oldest message.
 *
 * Each queue allows one active consumer. The returned stop function
 * cancels consumption without clearing buffered messages.
 *
 * Replace with BullMQ (Redis) or RabbitMQ for durable, distributed queuing.
 */
@Injectable()
export class InMemoryQueueProvider implements QueueProvider {
  private readonly context = InMemoryQueueProvider.name;
  private readonly buffers = new Map<string, BufferedMessage<unknown>[]>();
  private readonly consumers = new Map<string, MessageHandler<unknown>>();

  constructor(private readonly logger: AppLoggerService) {}

  async enqueue<T>(
    queueName: string,
    payload: T,
    _options?: EnqueueOptions,
  ): ReturnType<QueueProvider['enqueue']> {
    const messageId = randomUUID();
    const msg: BufferedMessage<T> = { messageId, payload, enqueuedAt: new Date(), attempts: 0 };

    const consumer = this.consumers.get(queueName);
    if (consumer) {
      await this.deliver(queueName, msg as BufferedMessage<unknown>, consumer);
    } else {
      if (!this.buffers.has(queueName)) this.buffers.set(queueName, []);
      const buffer = this.buffers.get(queueName)!;
      if (buffer.length >= MAX_BUFFER) {
        const dropped = buffer.shift();
        this.logger.warn(
          `Queue "${queueName}" buffer full — dropped message ${dropped?.messageId}`,
          this.context,
        );
      }
      buffer.push(msg as BufferedMessage<unknown>);
    }

    return ok(messageId);
  }

  async consume<T>(
    queueName: string,
    handler: MessageHandler<T>,
    _options?: ConsumeOptions,
  ): ReturnType<QueueProvider['consume']> {
    if (this.consumers.has(queueName)) {
      return err(
        new ServiceUnavailableError(`Queue "${queueName}" already has an active consumer`),
      );
    }

    this.consumers.set(queueName, handler as MessageHandler<unknown>);

    const buffered = this.buffers.get(queueName) ?? [];
    this.buffers.delete(queueName);
    for (const msg of buffered) {
      await this.deliver(queueName, msg, handler as MessageHandler<unknown>);
    }

    const stop = async (): Promise<void> => {
      this.consumers.delete(queueName);
    };

    return ok(stop);
  }

  async getQueueDepth(queueName: string): ReturnType<QueueProvider['getQueueDepth']> {
    const depth = this.buffers.get(queueName)?.length ?? 0;
    return ok(depth);
  }

  async purge(queueName: string): ReturnType<QueueProvider['purge']> {
    this.buffers.delete(queueName);
    return ok(undefined);
  }

  getProviderName(): string {
    return 'in-memory-queue';
  }

  async getHealth(): Promise<ProviderHealth> {
    const totalBuffered = [...this.buffers.values()].reduce((s, b) => s + b.length, 0);
    return healthyResult(
      `in-memory-queue — ${this.consumers.size} consumers, ${totalBuffered} buffered messages`,
    );
  }

  private async deliver<T>(
    queueName: string,
    msg: BufferedMessage<T>,
    handler: MessageHandler<T>,
  ): Promise<void> {
    msg.attempts++;
    let acknowledged = false;

    const message: QueueMessage<T> = {
      messageId: msg.messageId,
      payload: msg.payload,
      enqueuedAt: msg.enqueuedAt,
      attempts: msg.attempts,
      acknowledge: async (): Promise<void> => {
        acknowledged = true;
      },
      reject: async (requeue = false): Promise<void> => {
        acknowledged = true;
        if (requeue) {
          msg.attempts--;
          await this.enqueue(queueName, msg.payload);
        }
      },
    };

    try {
      await handler(message);
      if (!acknowledged) {
        this.logger.warn(
          `Message ${msg.messageId} in queue "${queueName}" was not acknowledged`,
          this.context,
        );
      }
    } catch (error) {
      this.logger.error(
        `Handler for queue "${queueName}" threw on message ${msg.messageId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
        this.context,
      );
    }
  }
}
