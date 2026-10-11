import { Result } from '@common/result';
import { InfrastructureError } from '@common/errors/infrastructure.error';
import { HealthCheckable } from '@infrastructure/health/health-check.interface';

export interface CacheSetOptions {
  ttlMs?: number;
  nx?: boolean;
}

export interface CacheProvider extends HealthCheckable {
  get<T>(key: string): Promise<Result<T | null, InfrastructureError>>;
  set<T>(
    key: string,
    value: T,
    options?: CacheSetOptions,
  ): Promise<Result<void, InfrastructureError>>;
  delete(key: string): Promise<Result<void, InfrastructureError>>;
  exists(key: string): Promise<Result<boolean, InfrastructureError>>;
  deleteByPattern(pattern: string): Promise<Result<number, InfrastructureError>>;
  clear(): Promise<Result<void, InfrastructureError>>;
  getProviderName(): string;
}
