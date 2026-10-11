import { registerAs } from '@nestjs/config';
import { BYBIT_REST_BASE_URL, BYBIT_TESTNET_BASE_URL, BYBIT_WS_BASE_URL } from './bybit.constants';

/**
 * BybitConfig holds credentials and connection parameters for all Bybit
 * adapters (Spot, Linear, Inverse). A single API key grants access to all
 * Bybit V5 categories — there is no separate key per product line.
 */
export interface BybitConfig {
  readonly apiKey: string;
  readonly secretKey: string;
  readonly baseUrl: string;
  readonly testnet: boolean;
  readonly timeoutMs: number;
  readonly recvWindowMs: number;
  readonly maxRetries: number;
  readonly wsBaseUrl: string;
  readonly wsHeartbeatIntervalMs: number;
  readonly wsHeartbeatTimeoutMs: number;
  readonly wsReconnectBaseDelayMs: number;
  readonly wsReconnectMaxDelayMs: number;
  readonly wsMaxReconnectAttempts: number;
}

export const bybitConfig = registerAs('bybit', (): BybitConfig => {
  const testnet = process.env.BYBIT_TESTNET === 'true';
  return {
    apiKey: process.env.BYBIT_API_KEY ?? '',
    secretKey: process.env.BYBIT_SECRET_KEY ?? '',
    baseUrl: testnet ? BYBIT_TESTNET_BASE_URL : (process.env.BYBIT_BASE_URL ?? BYBIT_REST_BASE_URL),
    testnet,
    timeoutMs: parseInt(process.env.BYBIT_TIMEOUT_MS ?? '10000', 10),
    recvWindowMs: parseInt(process.env.BYBIT_RECV_WINDOW_MS ?? '5000', 10),
    maxRetries: parseInt(process.env.BYBIT_MAX_RETRIES ?? '3', 10),
    wsBaseUrl: process.env.BYBIT_WS_BASE_URL ?? BYBIT_WS_BASE_URL,
    wsHeartbeatIntervalMs: parseInt(process.env.BYBIT_WS_HEARTBEAT_INTERVAL_MS ?? '20000', 10),
    wsHeartbeatTimeoutMs: parseInt(process.env.BYBIT_WS_HEARTBEAT_TIMEOUT_MS ?? '10000', 10),
    wsReconnectBaseDelayMs: parseInt(process.env.BYBIT_WS_RECONNECT_BASE_DELAY_MS ?? '1000', 10),
    wsReconnectMaxDelayMs: parseInt(process.env.BYBIT_WS_RECONNECT_MAX_DELAY_MS ?? '30000', 10),
    wsMaxReconnectAttempts: parseInt(process.env.BYBIT_WS_MAX_RECONNECT_ATTEMPTS ?? '10', 10),
  };
});
