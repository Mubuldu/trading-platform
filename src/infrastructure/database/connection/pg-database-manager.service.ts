import { Injectable } from '@nestjs/common';
import { ok, err } from '@common/result';
import { DatabaseError } from '@common/errors/infrastructure.error';
import {
  healthyResult,
  unhealthyResult,
  ProviderHealth,
} from '@infrastructure/health/health-check.interface';
import { DatabaseProvider } from '@infrastructure/providers/database/database-provider.interface';
import { PgPoolService } from './pg-pool.service';

/**
 * PgDatabaseManager implements DatabaseProvider using a pg connection pool.
 *
 * It replaces the NoopDatabaseProvider in InfrastructureModule for production.
 * The pool is always "connected" once created — connect() just verifies
 * that at least one connection can be acquired (ping).
 */
@Injectable()
export class PgDatabaseManager implements DatabaseProvider {
  private connected = false;

  constructor(private readonly pool: PgPoolService) {}

  async connect(): ReturnType<DatabaseProvider['connect']> {
    const pingResult = await this.ping();
    if (pingResult.isErr()) return pingResult;
    this.connected = true;
    return ok(undefined);
  }

  async disconnect(): ReturnType<DatabaseProvider['disconnect']> {
    this.connected = false;
    return ok(undefined);
  }

  async ping(): ReturnType<DatabaseProvider['ping']> {
    try {
      const client = await this.pool.rawPool.connect();
      await client.query('SELECT 1');
      client.release();
      return ok(undefined);
    } catch (error) {
      return err(
        new DatabaseError(
          'PostgreSQL ping failed',
          undefined,
          error instanceof Error ? error : undefined,
        ),
      );
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  getProviderName(): string {
    return 'postgresql';
  }

  async getHealth(): Promise<ProviderHealth> {
    const pingResult = await this.ping();
    if (pingResult.isErr()) {
      return unhealthyResult(`PostgreSQL unreachable: ${pingResult.error.message}`);
    }

    const pool = this.pool.rawPool;
    return healthyResult(
      `PostgreSQL healthy — pool: ${pool.totalCount} total / ${pool.idleCount} idle / ${pool.waitingCount} waiting`,
    );
  }
}
