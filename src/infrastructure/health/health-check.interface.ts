/**
 * ProviderHealth is the standard health report shape returned by every provider.
 *
 * Status semantics:
 *  healthy   — fully operational, requests are being served normally
 *  degraded  — operational but with reduced performance or partial capability
 *  unhealthy — not serving requests; should be excluded from load balancer rotation
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface ProviderHealth {
  readonly status: HealthStatus;
  readonly message?: string;
  readonly latencyMs?: number;
  readonly metadata?: Record<string, unknown>;
  readonly checkedAt: Date;
}

/**
 * HealthCheckResult is the output of a single named health check.
 */
export interface HealthCheckResult {
  readonly name: string;
  readonly health: ProviderHealth;
}

/**
 * HealthCheckable is the interface that every infrastructure provider implements
 * to expose its own health status to the HealthCheckRegistry.
 */
export interface HealthCheckable {
  getHealth(): Promise<ProviderHealth>;
}

/**
 * NamedHealthCheck is a standalone health check registered with the
 * HealthCheckRegistry. Providers register themselves on module initialization.
 */
export interface NamedHealthCheck {
  readonly name: string;
  check(): Promise<ProviderHealth>;
}

export function healthyResult(message?: string, latencyMs?: number): ProviderHealth {
  return {
    status: 'healthy',
    message,
    latencyMs,
    checkedAt: new Date(),
  };
}

export function degradedResult(message: string, latencyMs?: number): ProviderHealth {
  return {
    status: 'degraded',
    message,
    latencyMs,
    checkedAt: new Date(),
  };
}

export function unhealthyResult(message: string, latencyMs?: number): ProviderHealth {
  return {
    status: 'unhealthy',
    message,
    latencyMs,
    checkedAt: new Date(),
  };
}
