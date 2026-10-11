import { Result } from '@common/result';
import { DatabaseError } from '@common/errors/infrastructure.error';
import { HealthCheckable } from '@infrastructure/health/health-check.interface';

/**
 * DatabaseProvider abstracts the underlying database connection technology.
 *
 * Business modules never import database drivers (pg, typeorm, drizzle) directly.
 * They inject DatabaseProvider and call domain-specific repository methods.
 * The provider manages the connection lifecycle; repositories use it.
 *
 * Implementations: PostgreSQL, SQLite (test), CockroachDB, TimescaleDB.
 * The chosen implementation is bound in InfrastructureModule.
 *
 * Extension: for multi-tenancy or read replicas, extend this interface with
 * connection routing methods before adding any implementations.
 */
export interface DatabaseProvider extends HealthCheckable {
  connect(): Promise<Result<void, DatabaseError>>;
  disconnect(): Promise<Result<void, DatabaseError>>;
  ping(): Promise<Result<void, DatabaseError>>;
  isConnected(): boolean;
  getProviderName(): string;
}
