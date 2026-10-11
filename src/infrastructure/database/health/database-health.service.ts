import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import {
  ProviderHealth,
  healthyResult,
  unhealthyResult,
} from '@infrastructure/health/health-check.interface';
import { PgPoolService } from '../connection/pg-pool.service';

export interface DatabaseHealthMetrics {
  totalConnections: number;
  idleConnections: number;
  waitingClients: number;
  roundTripMs: number;
}

/**
 * DatabaseHealthService monitors PostgreSQL pool health at runtime.
 *
 * Called by the HealthCheckRegistry on each /health request.
 * Also exposes metrics() for dashboards and alerting systems.
 */
@Injectable()
export class DatabaseHealthService {
  private readonly context = DatabaseHealthService.name;

  constructor(
    private readonly pool: PgPoolService,
    private readonly logger: AppLoggerService,
  ) {}

  async getHealth(): Promise<ProviderHealth> {
    const start = Date.now();

    try {
      const client = await this.pool.rawPool.connect();
      await client.query('SELECT 1');
      client.release();

      const rtt = Date.now() - start;
      const pg = this.pool.rawPool;

      if (rtt > 1000) {
        return unhealthyResult(`PostgreSQL slow: ${rtt}ms round-trip`);
      }

      return healthyResult(
        `PostgreSQL healthy — ${rtt}ms RTT, pool: ${pg.totalCount}/${pg.idleCount} idle, ${pg.waitingCount} waiting`,
      );
    } catch (error) {
      this.logger.error('PostgreSQL health check failed', String(error), this.context);
      return unhealthyResult(`PostgreSQL unreachable: ${(error as Error).message}`);
    }
  }

  async metrics(): Promise<DatabaseHealthMetrics> {
    const start = Date.now();
    const client = await this.pool.rawPool.connect();
    await client.query('SELECT 1');
    client.release();

    const pg = this.pool.rawPool;
    return {
      totalConnections: pg.totalCount,
      idleConnections: pg.idleCount,
      waitingClients: pg.waitingCount,
      roundTripMs: Date.now() - start,
    };
  }
}
