import { ExchangeId } from '../enums/exchange.enums';

/**
 * FailoverMode controls how the router reacts when a primary exchange fails.
 *
 * NONE       — no failover; a failing exchange returns an error to the caller.
 *              Use in development and when a secondary is not available.
 *
 * AUTOMATIC  — the router switches to the secondary exchange transparently
 *              when the primary exceeds failoverThresholdMs of consecutive
 *              health-check failures. No human action required.
 *
 * MANUAL     — the router never switches automatically. An operator must call
 *              ExchangeRouter.triggerManualFailover() explicitly. Use when
 *              automatic failover carries execution risk (e.g. open positions
 *              on the primary that do not exist on the secondary).
 */
export enum FailoverMode {
  NONE = 'NONE',
  AUTOMATIC = 'AUTOMATIC',
  MANUAL = 'MANUAL',
}

/**
 * FailoverConfig declares the failover policy for a single primary exchange.
 *
 * Fields:
 *  primaryExchangeId         — the exchange this config governs
 *  secondaryExchangeId       — the exchange to route to when primary fails
 *                              (optional; required for AUTOMATIC / MANUAL)
 *  mode                      — how failover is triggered (see FailoverMode)
 *  healthCheckIntervalMs     — how often the registry polls the primary
 *                              health status for automatic failover decisions
 *  failoverThresholdMs       — consecutive unhealthy time before automatic
 *                              failover is triggered (AUTOMATIC mode only)
 *  recoveryThresholdMs       — consecutive healthy time before the router
 *                              reverts from secondary back to primary
 *  maintenanceWindowExchangeId — exchange to use during planned maintenance;
 *                              if absent, secondaryExchangeId is used
 */
export interface FailoverConfig {
  readonly primaryExchangeId: ExchangeId;
  readonly secondaryExchangeId?: ExchangeId;
  readonly mode: FailoverMode;
  readonly healthCheckIntervalMs: number;
  readonly failoverThresholdMs: number;
  readonly recoveryThresholdMs: number;
  readonly maintenanceWindowExchangeId?: ExchangeId;
}

/**
 * FailoverState records whether an exchange is currently in failover and
 * which exchange is serving its traffic.
 */
export interface FailoverState {
  readonly primaryExchangeId: ExchangeId;
  readonly activeExchangeId: ExchangeId;
  readonly mode: FailoverMode;
  readonly triggeredAt: Date;
  readonly triggeredBy: 'automatic' | 'manual' | 'maintenance';
}

/** Defaults for FailoverConfig optional fields. */
export const FAILOVER_DEFAULTS = {
  healthCheckIntervalMs: 15_000,
  failoverThresholdMs: 30_000,
  recoveryThresholdMs: 120_000,
} as const;
