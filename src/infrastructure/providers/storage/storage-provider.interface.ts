import { Result } from '@common/result';
import { InfrastructureError } from '@common/errors/infrastructure.error';
import { HealthCheckable } from '@infrastructure/health/health-check.interface';

export interface StorageWriteOptions {
  contentType?: string;
  metadata?: Record<string, string>;
  overwrite?: boolean;
}

export interface StorageObject {
  key: string;
  size: number;
  contentType?: string;
  metadata?: Record<string, string>;
  lastModified: Date;
}

/**
 * StorageProvider abstracts binary object storage (S3, GCS, local filesystem).
 *
 * Used for: trade confirmations, statement PDFs, audit log archives,
 * market data snapshots, and any large binary artifact.
 *
 * Never store secrets or trading state in the storage provider.
 * Never call StorageProvider from within a database transaction.
 */
export interface StorageProvider extends HealthCheckable {
  read(key: string): Promise<Result<Buffer, InfrastructureError>>;
  write(
    key: string,
    data: Buffer,
    options?: StorageWriteOptions,
  ): Promise<Result<void, InfrastructureError>>;
  delete(key: string): Promise<Result<void, InfrastructureError>>;
  exists(key: string): Promise<Result<boolean, InfrastructureError>>;
  list(prefix: string, maxKeys?: number): Promise<Result<StorageObject[], InfrastructureError>>;
  getSignedUrl(key: string, expiresInSeconds: number): Promise<Result<string, InfrastructureError>>;
  getProviderName(): string;
}
