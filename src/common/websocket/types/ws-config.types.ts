/**
 * Configuration for the WebSocket connection manager.
 * All timeouts are in milliseconds.
 */
export interface WsClientConfig {
  /** Full WebSocket URL, e.g. wss://stream.binance.com:9443/stream */
  readonly url: string;

  /** How often to send a protocol PING frame. Default: 20 000 */
  readonly heartbeatIntervalMs: number;

  /**
   * After sending a PING, how long to wait before counting it as missed.
   * Must be less than heartbeatIntervalMs. Default: 10 000
   */
  readonly heartbeatTimeoutMs: number;

  /** How many consecutive missed heartbeats before forcing a reconnect. Default: 3 */
  readonly missedHeartbeatsThreshold: number;

  /** Base delay for exponential backoff on reconnect. Default: 1 000 */
  readonly reconnectBaseDelayMs: number;

  /** Cap on the reconnect delay. Default: 30 000 */
  readonly reconnectMaxDelayMs: number;

  /**
   * Maximum reconnect attempts before transitioning to FAILED.
   * -1 = retry indefinitely. Default: 10
   */
  readonly maxReconnectAttempts: number;

  /**
   * If the connection stays CONNECTED for this long, reset the backoff counter.
   * Prevents a flaky connection from quickly using up all retries. Default: 30 000
   */
  readonly stableConnectionThresholdMs: number;

  /** Reject any single message larger than this (bytes). Default: 10 485 760 (10 MB) */
  readonly maxMessageSizeBytes: number;

  /** Optional extra HTTP headers for the upgrade request (e.g. API-Key). */
  readonly headers?: Readonly<Record<string, string>>;
}

export const WS_CLIENT_CONFIG_DEFAULTS: Omit<WsClientConfig, 'url'> = {
  heartbeatIntervalMs: 20_000,
  heartbeatTimeoutMs: 10_000,
  missedHeartbeatsThreshold: 3,
  reconnectBaseDelayMs: 1_000,
  reconnectMaxDelayMs: 30_000,
  maxReconnectAttempts: 10,
  stableConnectionThresholdMs: 30_000,
  maxMessageSizeBytes: 10 * 1024 * 1024,
};
