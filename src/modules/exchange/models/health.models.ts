import { ExchangeId } from '../enums/exchange.enums';

/**
 * ConnectionStatus describes the current liveness of an exchange connection.
 *
 * CONNECTED    — adapter is reachable; REST and WebSocket are operational
 * DEGRADED     — connection exists but latency or error rate is elevated
 * DISCONNECTED — connection is not established or was lost
 * MAINTENANCE  — exchange has declared a maintenance window
 * UNKNOWN      — health has not yet been assessed
 */
export enum ConnectionStatus {
  CONNECTED = 'CONNECTED',
  DEGRADED = 'DEGRADED',
  DISCONNECTED = 'DISCONNECTED',
  MAINTENANCE = 'MAINTENANCE',
  UNKNOWN = 'UNKNOWN',
}

/**
 * RateLimitHealthLevel classifies how close an adapter is to hitting its
 * rate limit ceiling. Thresholds are: OK < 80% used, WARNING < 95%, CRITICAL >= 95%.
 */
export type RateLimitHealthLevel = 'OK' | 'WARNING' | 'CRITICAL';

/**
 * ExchangeHealthStatus is a point-in-time snapshot of an exchange adapter's
 * operational state.
 *
 * Produced by ExchangeRegistry.runHealthCheck() and stored in the registry.
 * The ExchangeRouter consults this before routing orders to an exchange.
 *
 * Fields:
 *  exchangeId        — which exchange this status describes
 *  isEnabled         — whether the exchange is enabled in the registry
 *  connectionStatus  — overall composite status
 *  restStatus        — REST API connectivity
 *  wsStatus          — WebSocket feed connectivity
 *  latencyMs         — last measured round-trip latency (null if unreachable)
 *  clockDriftMs      — local-vs-exchange clock skew (null if not measured)
 *  rateLimitHealth   — how close the adapter is to its rate limit
 *  isAuthenticated   — whether the last signed request succeeded
 *  isMaintenance     — whether the exchange reported maintenance mode
 *  checkedAt         — wall-clock time this snapshot was taken
 */
export interface ExchangeHealthStatus {
  readonly exchangeId: ExchangeId;
  readonly isEnabled: boolean;
  readonly connectionStatus: ConnectionStatus;
  readonly restStatus: ConnectionStatus;
  readonly wsStatus: ConnectionStatus;
  readonly latencyMs: number | null;
  readonly clockDriftMs: number | null;
  readonly rateLimitHealth: RateLimitHealthLevel;
  readonly isAuthenticated: boolean;
  readonly isMaintenance: boolean;
  readonly checkedAt: Date;
}

/**
 * HealthCheckSummary aggregates health across all registered exchanges.
 * Used by the /health endpoint and monitoring dashboards.
 */
export interface HealthCheckSummary {
  readonly healthy: ExchangeId[];
  readonly degraded: ExchangeId[];
  readonly unhealthy: ExchangeId[];
  readonly maintenance: ExchangeId[];
  readonly unknown: ExchangeId[];
  readonly checkedAt: Date;
}
