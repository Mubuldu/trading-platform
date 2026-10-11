export const STREAM_SCHEMA_VERSION = '1.0.0';

export interface StreamEvent {
  readonly eventId: string;
  readonly correlationId: string;
  readonly eventType: string;
  readonly exchange: string;
  readonly symbol: string;
  readonly timestamp: number;
  readonly producer: string;
  readonly schemaVersion: string;
  readonly payload: Record<string, unknown>;
  readonly metadata: StreamEventMetadata;
}

export interface StreamEventMetadata {
  readonly retryCount: number;
  readonly originalStreamId?: string;
  readonly sourceConsumer?: string;
  readonly processingStartedAt?: number;
  [key: string]: unknown;
}

export interface DeadLetterEvent {
  readonly originalEvent: string;
  readonly failureReason: string;
  readonly retryCount: number;
  readonly timestamp: number;
  readonly producer: string;
  readonly consumer: string;
  readonly streamName: string;
  readonly originalStreamId: string;
}

export interface StreamEntryRaw {
  id: string;
  fields: Record<string, string>;
}

export interface ConsumedMessage {
  readonly streamId: string;
  readonly event: StreamEvent;
  readonly streamName: string;
  readonly consumerGroup: string;
  readonly consumerName: string;
}

export interface PendingMessage {
  readonly streamId: string;
  readonly consumerName: string;
  readonly idleMs: number;
  readonly retryCount: number;
}

export interface ConsumerInfo {
  readonly name: string;
  readonly pending: number;
  readonly idleMs: number;
  readonly inactive: number;
}

export interface GroupInfo {
  readonly name: string;
  readonly consumers: number;
  readonly pending: number;
  readonly lastDeliveredId: string;
  readonly entriesRead: number | null;
  readonly lag: number | null;
}
