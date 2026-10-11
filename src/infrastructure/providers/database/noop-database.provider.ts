import { Injectable } from '@nestjs/common';
import { ok } from '@common/result';
import { healthyResult, ProviderHealth } from '@infrastructure/health/health-check.interface';
import { DatabaseProvider } from './database-provider.interface';

/**
 * NoopDatabaseProvider satisfies the DatabaseProvider contract without
 * connecting to any real database. It is the default binding until a
 * real database adapter (TypeORM, Drizzle, Prisma) is introduced.
 *
 * It always reports itself as connected and healthy so startup
 * health checks pass in development environments that have no DB configured.
 *
 * Replace this by binding a real implementation in InfrastructureModule.
 */
@Injectable()
export class NoopDatabaseProvider implements DatabaseProvider {
  private connected = false;

  async connect(): ReturnType<DatabaseProvider['connect']> {
    this.connected = true;
    return ok(undefined);
  }

  async disconnect(): ReturnType<DatabaseProvider['disconnect']> {
    this.connected = false;
    return ok(undefined);
  }

  async ping(): ReturnType<DatabaseProvider['ping']> {
    return ok(undefined);
  }

  isConnected(): boolean {
    return this.connected;
  }

  getProviderName(): string {
    return 'noop-database';
  }

  async getHealth(): Promise<ProviderHealth> {
    return healthyResult('No database configured — noop provider active');
  }
}
