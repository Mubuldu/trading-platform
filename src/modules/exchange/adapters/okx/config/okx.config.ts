import { registerAs } from '@nestjs/config';
import { OKX_REST_BASE_URL, OKX_WS_PUBLIC_BASE_URL } from './okx.constants';

/**
 * OkxConfig holds credentials and connection parameters for all OKX adapters.
 *
 * OKX V5 requires three credentials: apiKey, secretKey, and passphrase.
 * Demo/testnet trading is enabled by setting the x-simulated-trading header
 * rather than using a different URL.
 */
export interface OkxConfig {
  readonly apiKey: string;
  readonly secretKey: string;
  readonly passphrase: string;
  readonly baseUrl: string;
  readonly simulatedTrading: boolean;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly wsPublicBaseUrl: string;
  readonly wsHeartbeatIntervalMs: number;
  readonly wsHeartbeatTimeoutMs: number;
  readonly wsReconnectBaseDelayMs: number;
  readonly wsReconnectMaxDelayMs: number;
  readonly wsMaxReconnectAttempts: number;
}

export const okxConfig = registerAs('okx', (): OkxConfig => ({
  apiKey: process.env.OKX_API_KEY ?? '',
  secretKey: process.env.OKX_SECRET_KEY ?? '',
  passphrase: process.env.OKX_PASSPHRASE ?? '',
  baseUrl: process.env.OKX_BASE_URL ?? OKX_REST_BASE_URL,
  simulatedTrading: process.env.OKX_SIMULATED_TRADING === 'true',
  timeoutMs: parseInt(process.env.OKX_TIMEOUT_MS ?? '10000', 10),
  maxRetries: parseInt(process.env.OKX_MAX_RETRIES ?? '3', 10),
  wsPublicBaseUrl: process.env.OKX_WS_BASE_URL ?? OKX_WS_PUBLIC_BASE_URL,
  wsHeartbeatIntervalMs: parseInt(process.env.OKX_WS_HEARTBEAT_INTERVAL_MS ?? '20000', 10),
  wsHeartbeatTimeoutMs: parseInt(process.env.OKX_WS_HEARTBEAT_TIMEOUT_MS ?? '10000', 10),
  wsReconnectBaseDelayMs: parseInt(process.env.OKX_WS_RECONNECT_BASE_DELAY_MS ?? '1000', 10),
  wsReconnectMaxDelayMs: parseInt(process.env.OKX_WS_RECONNECT_MAX_DELAY_MS ?? '30000', 10),
  wsMaxReconnectAttempts: parseInt(process.env.OKX_WS_MAX_RECONNECT_ATTEMPTS ?? '10', 10),
}));
