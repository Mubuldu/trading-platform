import { WsConnectionState } from '../enums/ws-connection-state.enum';

/** Descriptive statistics over a rolling sample window. */
export interface LatencySample {
  readonly current: number;
  readonly min: number;
  readonly max: number;
  readonly avg: number;
  /** 95th percentile. */
  readonly p95: number;
  /** 99th percentile. */
  readonly p99: number;
  readonly sampleCount: number;
}

/** Three-dimensional latency breakdown. */
export interface WsLatencyMetrics {
  /**
   * Time from socket receive event to message handler call (processing overhead).
   * Includes JSON parse + normalization.
   */
  readonly networkLatencyMs: LatencySample;

  /**
   * Time from socket receive to normalized event being published.
   * Includes every step: parse, normalize, dispatch.
   */
  readonly processingLatencyMs: LatencySample;

  /**
   * Exchange event timestamp vs. local receive time.
   * Positive = exchange is ahead; negative = exchange is behind.
   */
  readonly messageDelayMs: LatencySample;

  /**
   * Rolling average of (localReceiveTime - exchangeEventTime).
   * Approximates clock skew between the local host and the exchange.
   */
  readonly clockDriftMs: number;
}

/** Counters and rates for a single WebSocket connection. */
export interface WsConnectionMetrics {
  readonly state: WsConnectionState;
  readonly connectedAt: Date | null;
  readonly uptimeMs: number;
  readonly reconnectCount: number;
  readonly totalMessagesReceived: number;
  readonly totalBytesReceived: number;
  readonly totalErrors: number;
  /** Messages received in the last 1-second window. */
  readonly messagesPerSecond: number;
  /** Bytes received in the last 1-second window. */
  readonly bytesPerSecond: number;
  readonly subscriptionCount: number;
}
