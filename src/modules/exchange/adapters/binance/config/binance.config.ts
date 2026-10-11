import { registerAs } from '@nestjs/config';
import {
  BINANCE_SPOT_BASE_URL,
  BINANCE_TESTNET_BASE_URL,
  BINANCE_WS_SPOT_BASE_URL,
} from './binance.constants';

export interface BinanceSpotConfig {
  // ── REST ──────────────────────────────────────────────────────────────────
  readonly apiKey: string;
  readonly secretKey: string;
  readonly baseUrl: string;
  readonly testnet: boolean;
  readonly timeoutMs: number;
  readonly recvWindowMs: number;
  readonly maxRetries: number;
  readonly connectionPoolSize: number;
  // ── WebSocket ─────────────────────────────────────────────────────────────
  readonly wsBaseUrl: string;
  readonly wsHeartbeatIntervalMs: number;
  readonly wsHeartbeatTimeoutMs: number;
  readonly wsMissedHeartbeatsThreshold: number;
  readonly wsReconnectBaseDelayMs: number;
  readonly wsReconnectMaxDelayMs: number;
  readonly wsMaxReconnectAttempts: number;
  readonly wsReconnectStableThresholdMs: number;
  readonly wsMaxStreams: number;
  readonly wsMaxMessageSizeBytes: number;
}

export const binanceConfig = registerAs('binance', (): BinanceSpotConfig => {
  const testnet = process.env.BINANCE_SPOT_TESTNET === 'true';
  return {
    apiKey: process.env.BINANCE_SPOT_API_KEY ?? '',
    secretKey: process.env.BINANCE_SPOT_SECRET_KEY ?? '',
    baseUrl: testnet
      ? BINANCE_TESTNET_BASE_URL
      : (process.env.BINANCE_SPOT_BASE_URL ?? BINANCE_SPOT_BASE_URL),
    testnet,
    timeoutMs: parseInt(process.env.BINANCE_SPOT_TIMEOUT_MS ?? '10000', 10),
    recvWindowMs: parseInt(process.env.BINANCE_SPOT_RECV_WINDOW_MS ?? '5000', 10),
    maxRetries: parseInt(process.env.BINANCE_SPOT_MAX_RETRIES ?? '3', 10),
    connectionPoolSize: parseInt(process.env.BINANCE_SPOT_POOL_SIZE ?? '10', 10),
    wsBaseUrl: process.env.BINANCE_SPOT_WS_BASE_URL ?? BINANCE_WS_SPOT_BASE_URL,
    wsHeartbeatIntervalMs: parseInt(
      process.env.BINANCE_SPOT_WS_HEARTBEAT_INTERVAL_MS ?? '20000',
      10,
    ),
    wsHeartbeatTimeoutMs: parseInt(process.env.BINANCE_SPOT_WS_HEARTBEAT_TIMEOUT_MS ?? '10000', 10),
    wsMissedHeartbeatsThreshold: parseInt(process.env.BINANCE_SPOT_WS_MISSED_HEARTBEATS ?? '3', 10),
    wsReconnectBaseDelayMs: parseInt(
      process.env.BINANCE_SPOT_WS_RECONNECT_BASE_DELAY_MS ?? '1000',
      10,
    ),
    wsReconnectMaxDelayMs: parseInt(
      process.env.BINANCE_SPOT_WS_RECONNECT_MAX_DELAY_MS ?? '30000',
      10,
    ),
    wsMaxReconnectAttempts: parseInt(
      process.env.BINANCE_SPOT_WS_MAX_RECONNECT_ATTEMPTS ?? '10',
      10,
    ),
    wsReconnectStableThresholdMs: parseInt(
      process.env.BINANCE_SPOT_WS_RECONNECT_STABLE_MS ?? '30000',
      10,
    ),
    wsMaxStreams: parseInt(process.env.BINANCE_SPOT_WS_MAX_STREAMS ?? '200', 10),
    wsMaxMessageSizeBytes: parseInt(
      process.env.BINANCE_SPOT_WS_MAX_MESSAGE_SIZE_BYTES ?? '10485760',
      10,
    ),
  };
});
