import { registerAs } from '@nestjs/config';
import {
  KRAKEN_REST_BASE_URL,
  KRAKEN_FUTURES_BASE_URL,
  KRAKEN_WS_BASE_URL,
} from './kraken.constants';

/**
 * KrakenConfig holds credentials for Kraken Spot and Futures.
 *
 * Kraken uses API key + private key (base64-encoded secret) for authentication.
 * Futures credentials are separate from Spot credentials.
 */
export interface KrakenConfig {
  // ── Spot ──────────────────────────────────────────────────────────────────
  readonly spotApiKey: string;
  readonly spotPrivateKey: string;
  readonly spotBaseUrl: string;

  // ── Futures ───────────────────────────────────────────────────────────────
  readonly futuresApiKey: string;
  readonly futuresPrivateKey: string;
  readonly futuresBaseUrl: string;

  // ── Common ────────────────────────────────────────────────────────────────
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly wsBaseUrl: string;
  readonly wsHeartbeatIntervalMs: number;
  readonly wsHeartbeatTimeoutMs: number;
  readonly wsReconnectBaseDelayMs: number;
  readonly wsReconnectMaxDelayMs: number;
  readonly wsMaxReconnectAttempts: number;
}

export const krakenConfig = registerAs('kraken', (): KrakenConfig => ({
  spotApiKey: process.env.KRAKEN_SPOT_API_KEY ?? '',
  spotPrivateKey: process.env.KRAKEN_SPOT_PRIVATE_KEY ?? '',
  spotBaseUrl: process.env.KRAKEN_SPOT_BASE_URL ?? KRAKEN_REST_BASE_URL,
  futuresApiKey: process.env.KRAKEN_FUTURES_API_KEY ?? '',
  futuresPrivateKey: process.env.KRAKEN_FUTURES_PRIVATE_KEY ?? '',
  futuresBaseUrl: process.env.KRAKEN_FUTURES_BASE_URL ?? KRAKEN_FUTURES_BASE_URL,
  timeoutMs: parseInt(process.env.KRAKEN_TIMEOUT_MS ?? '10000', 10),
  maxRetries: parseInt(process.env.KRAKEN_MAX_RETRIES ?? '3', 10),
  wsBaseUrl: process.env.KRAKEN_WS_BASE_URL ?? KRAKEN_WS_BASE_URL,
  wsHeartbeatIntervalMs: parseInt(process.env.KRAKEN_WS_HEARTBEAT_INTERVAL_MS ?? '30000', 10),
  wsHeartbeatTimeoutMs: parseInt(process.env.KRAKEN_WS_HEARTBEAT_TIMEOUT_MS ?? '10000', 10),
  wsReconnectBaseDelayMs: parseInt(process.env.KRAKEN_WS_RECONNECT_BASE_DELAY_MS ?? '1000', 10),
  wsReconnectMaxDelayMs: parseInt(process.env.KRAKEN_WS_RECONNECT_MAX_DELAY_MS ?? '30000', 10),
  wsMaxReconnectAttempts: parseInt(process.env.KRAKEN_WS_MAX_RECONNECT_ATTEMPTS ?? '10', 10),
}));
