import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import {
  NamedHealthCheck,
  HealthCheckResult,
  ProviderHealth,
  HealthStatus,
  unhealthyResult,
} from './health-check.interface';

export interface AggregatedHealth {
  status: HealthStatus;
  checks: HealthCheckResult[];
  checkedAt: Date;
}

/**
 * HealthCheckRegistry is the single source of truth for infrastructure health.
 *
 * Every provider registers a named health check on module initialization.
 * The health controller queries the registry to build its response.
 *
 * Aggregate status rules:
 *  - 'healthy' only when ALL checks are healthy
 *  - 'degraded' when ANY check is degraded (but none are unhealthy)
 *  - 'unhealthy' when ANY check is unhealthy
 *
 * Individual check timeouts are respected — a hung provider does not
 * block the entire health response. Each check wraps its execution in a
 * timeout using Promise.race.
 *
 * Extension: add priority tiers — critical checks (database) vs optional
 * checks (notification backend) with different failure policies.
 */
@Injectable()
export class HealthCheckRegistry {
  private readonly context = HealthCheckRegistry.name;
  private readonly checks = new Map<string, NamedHealthCheck>();
  private readonly CHECK_TIMEOUT_MS = 5_000;

  constructor(private readonly logger: AppLoggerService) {}

  register(check: NamedHealthCheck): void {
    if (this.checks.has(check.name)) {
      this.logger.warn(
        `Health check "${check.name}" is already registered — overwriting`,
        this.context,
      );
    }
    this.checks.set(check.name, check);
    this.logger.debug(`Registered health check: ${check.name}`, this.context);
  }

  unregister(name: string): void {
    this.checks.delete(name);
  }

  async runAll(): Promise<AggregatedHealth> {
    const results = await Promise.all([...this.checks.values()].map((check) => this.runOne(check)));

    const status = this.aggregate(results.map((r) => r.health.status));

    return {
      status,
      checks: results,
      checkedAt: new Date(),
    };
  }

  async runSingle(name: string): Promise<HealthCheckResult | undefined> {
    const check = this.checks.get(name);
    if (!check) return undefined;
    return this.runOne(check);
  }

  get registeredNames(): string[] {
    return [...this.checks.keys()];
  }

  private async runOne(check: NamedHealthCheck): Promise<HealthCheckResult> {
    const timeoutPromise = new Promise<ProviderHealth>((resolve) => {
      const handle = setTimeout(
        () =>
          resolve(
            unhealthyResult(
              `Health check "${check.name}" timed out after ${this.CHECK_TIMEOUT_MS}ms`,
            ),
          ),
        this.CHECK_TIMEOUT_MS,
      );
      handle.unref();
    });

    const health = await Promise.race([check.check(), timeoutPromise]).catch(
      (error: unknown): ProviderHealth =>
        unhealthyResult(
          `Health check "${check.name}" threw: ${error instanceof Error ? error.message : String(error)}`,
        ),
    );

    if (health.status !== 'healthy') {
      this.logger.warn(
        `Health check "${check.name}" is ${health.status}: ${health.message ?? 'no message'}`,
        this.context,
      );
    }

    return { name: check.name, health };
  }

  private aggregate(statuses: HealthStatus[]): HealthStatus {
    if (statuses.some((s) => s === 'unhealthy')) return 'unhealthy';
    if (statuses.some((s) => s === 'degraded')) return 'degraded';
    return 'healthy';
  }
}
