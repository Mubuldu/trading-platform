import { Injectable, OnModuleInit } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { DatabaseProvider } from '@infrastructure/providers/database/database-provider.interface';
import {
  HealthCheckResult,
  ProviderHealth,
  unhealthyResult,
} from '@infrastructure/health/health-check.interface';

interface ManagedConnection {
  name: string;
  provider: DatabaseProvider;
}

/**
 * ConnectionManager owns the lifecycle of all database connections.
 *
 * Modules that need a database connection register their DatabaseProvider
 * with this manager. The manager connects them all during startup and
 * disconnects them all during shutdown.
 *
 * ConnectionManager itself does not implement lifecycle hooks — it is driven
 * by the LifecycleManager via a registered LifecycleHook. InfrastructureModule
 * registers it with priority 100 (connects before any other service starts).
 *
 * Health: getConnectionHealth() returns the health of each registered connection,
 * consumed by the HealthCheckRegistry.
 */
@Injectable()
export class ConnectionManager implements OnModuleInit {
  private readonly context = ConnectionManager.name;
  private readonly connections = new Map<string, ManagedConnection>();

  constructor(private readonly logger: AppLoggerService) {}

  onModuleInit(): void {
    this.logger.debug('ConnectionManager initialized', this.context);
  }

  register(name: string, provider: DatabaseProvider): void {
    if (this.connections.has(name)) {
      this.logger.warn(`Connection "${name}" is already registered — overwriting`, this.context);
    }
    this.connections.set(name, { name, provider });
    this.logger.debug(
      `Connection registered: ${name} (${provider.getProviderName()})`,
      this.context,
    );
  }

  async connectAll(): Promise<void> {
    for (const [name, conn] of this.connections) {
      const start = Date.now();
      const result = await conn.provider.connect();
      if (result.isErr()) {
        this.logger.error(
          `Failed to connect "${name}": ${result.error.message}`,
          result.error.stack,
          this.context,
        );
      } else {
        this.logger.log(`Connected "${name}" in ${Date.now() - start}ms`, this.context);
      }
    }
  }

  async disconnectAll(): Promise<void> {
    for (const [name, conn] of this.connections) {
      const result = await conn.provider.disconnect();
      if (result.isErr()) {
        this.logger.error(
          `Failed to disconnect "${name}" cleanly: ${result.error.message}`,
          result.error.stack,
          this.context,
        );
      } else {
        this.logger.log(`Disconnected "${name}"`, this.context);
      }
    }
  }

  isConnected(name: string): boolean {
    return this.connections.get(name)?.provider.isConnected() ?? false;
  }

  isAllConnected(): boolean {
    return [...this.connections.values()].every((c) => c.provider.isConnected());
  }

  async getConnectionHealth(name: string): Promise<HealthCheckResult | undefined> {
    const conn = this.connections.get(name);
    if (!conn) return undefined;
    const health = await conn.provider
      .getHealth()
      .catch((): ProviderHealth => unhealthyResult(`Connection "${name}" health check threw`));
    return { name, health };
  }

  get registeredNames(): string[] {
    return [...this.connections.keys()];
  }
}
