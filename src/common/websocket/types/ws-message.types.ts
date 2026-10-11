/**
 * A raw incoming WebSocket message before any parsing or normalization.
 */
export interface WsRawMessage {
  /** UTF-8 string payload (JSON text). Binary frames are coerced to string. */
  readonly data: string;
  /** Date.now() at the moment the 'message' event fired. */
  readonly receivedAt: number;
  /** Byte length of the raw payload. */
  readonly byteLength: number;
}

/**
 * Metadata attached to every dispatched message.
 * Allows handlers to measure latency and correlate stream updates.
 */
export interface WsMessageMeta {
  /** The exchange stream identifier, e.g. "btcusdt@ticker". */
  readonly streamId: string;
  /** Wall-clock time when the socket received the message. */
  readonly receivedAt: Date;
  /** Milliseconds from socket receive to handler invocation. */
  readonly processingLatencyMs: number;
  /** Exchange-provided sequence/update ID, if present. */
  readonly sequenceId?: number;
}

/** Handler called for every message dispatched to a stream subscription. */
export type WsMessageHandler<T = unknown> = (data: T, meta: WsMessageMeta) => void;
