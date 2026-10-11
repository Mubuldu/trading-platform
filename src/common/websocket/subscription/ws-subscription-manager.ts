import { randomUUID } from 'crypto';
import { WsMessageHandler, WsMessageMeta } from '../types/ws-message.types';

interface StreamRecord {
  readonly id: string;
  readonly streamId: string;
  readonly handlers: Set<WsMessageHandler>;
  readonly subscribedAt: Date;
  lastMessageAt: Date | null;
}

interface SubscribeResult {
  readonly subscriptionId: string;
  /** True when this is the first subscriber to this streamId. */
  readonly isNewStream: boolean;
}

interface UnsubscribeResult {
  /** True when the handler was actually removed. */
  readonly removed: boolean;
  /** True when the stream has no remaining handlers and was deleted. */
  readonly streamRemoved: boolean;
}

/**
 * WsSubscriptionManager tracks active stream subscriptions and dispatches
 * incoming messages to the registered handlers.
 *
 * Key properties:
 *  - Multiple handlers per stream (fan-out).
 *  - Duplicate handler registration for the same stream is idempotent.
 *  - Handler errors are swallowed to isolate subscribers from each other.
 *  - Bounded by maxStreams to prevent unbounded memory growth.
 *  - destroy() clears all state — call on shutdown.
 */
export class WsSubscriptionManager {
  private readonly streams = new Map<string, StreamRecord>();
  private readonly maxStreams: number;

  constructor(maxStreams: number) {
    this.maxStreams = maxStreams;
  }

  /**
   * Register a handler for a stream.
   *
   * @returns SubscribeResult, or null if the subscription limit is reached.
   */
  subscribe(streamId: string, handler: WsMessageHandler): SubscribeResult | null {
    let record = this.streams.get(streamId);
    const isNew = record === undefined;

    if (isNew) {
      if (this.streams.size >= this.maxStreams) return null;
      record = {
        id: randomUUID(),
        streamId,
        handlers: new Set(),
        subscribedAt: new Date(),
        lastMessageAt: null,
      };
      this.streams.set(streamId, record);
    }

    record!.handlers.add(handler);
    return { subscriptionId: record!.id, isNewStream: isNew };
  }

  /**
   * Remove a specific handler from a stream.
   * When the last handler is removed, the stream record is deleted.
   */
  unsubscribe(streamId: string, handler: WsMessageHandler): UnsubscribeResult {
    const record = this.streams.get(streamId);
    if (!record) return { removed: false, streamRemoved: false };

    const removed = record.handlers.delete(handler);
    if (record.handlers.size === 0) {
      this.streams.delete(streamId);
      return { removed, streamRemoved: true };
    }
    return { removed, streamRemoved: false };
  }

  /** Remove ALL handlers for a stream immediately. */
  unsubscribeStream(streamId: string): boolean {
    return this.streams.delete(streamId);
  }

  /** Dispatch a message to all handlers registered for streamId. */
  dispatch<T>(streamId: string, data: T, meta: WsMessageMeta): void {
    const record = this.streams.get(streamId);
    if (!record) return;
    record.lastMessageAt = new Date();
    for (const handler of record.handlers) {
      try {
        (handler as WsMessageHandler<T>)(data, meta);
      } catch {
        // Handler errors must not crash the dispatcher
      }
    }
  }

  /** True when the stream has at least one handler registered. */
  hasStream(streamId: string): boolean {
    return this.streams.has(streamId);
  }

  /** Returns a snapshot of all currently subscribed stream IDs. */
  getStreamIds(): readonly string[] {
    return [...this.streams.keys()];
  }

  get streamCount(): number {
    return this.streams.size;
  }

  get handlerCount(): number {
    let total = 0;
    for (const r of this.streams.values()) total += r.handlers.size;
    return total;
  }

  /** Clear all subscriptions — call on graceful shutdown. */
  destroy(): void {
    for (const record of this.streams.values()) {
      record.handlers.clear();
    }
    this.streams.clear();
  }
}
