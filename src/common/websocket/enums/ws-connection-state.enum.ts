export enum WsConnectionState {
  /** No connection exists. connect() may be called. */
  DISCONNECTED = 'DISCONNECTED',
  /** TCP + TLS + WebSocket handshake in progress. */
  CONNECTING = 'CONNECTING',
  /** Handshake complete. Messages flowing. */
  CONNECTED = 'CONNECTED',
  /** Connection lost. Waiting for backoff before next attempt. */
  RECONNECTING = 'RECONNECTING',
  /** Exceeded maxReconnectAttempts. Will not retry automatically. */
  FAILED = 'FAILED',
  /** stop() was called. Terminal state — create a new manager to reconnect. */
  STOPPED = 'STOPPED',
}
