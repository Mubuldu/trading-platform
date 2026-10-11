import { Injectable } from '@nestjs/common';
import { ok } from '@common/result';
import { healthyResult, ProviderHealth } from '@infrastructure/health/health-check.interface';
import { StorageProvider, StorageWriteOptions, StorageObject } from './storage-provider.interface';

/**
 * NoopStorageProvider discards all data silently.
 * Satisfies the interface so modules compile without a real storage backend.
 * Replace with S3StorageProvider, GcsStorageProvider, or LocalStorageProvider.
 */
@Injectable()
export class NoopStorageProvider implements StorageProvider {
  async read(_key: string): ReturnType<StorageProvider['read']> {
    return ok(Buffer.alloc(0));
  }

  async write(
    _key: string,
    _data: Buffer,
    _options?: StorageWriteOptions,
  ): ReturnType<StorageProvider['write']> {
    return ok(undefined);
  }

  async delete(_key: string): ReturnType<StorageProvider['delete']> {
    return ok(undefined);
  }

  async exists(_key: string): ReturnType<StorageProvider['exists']> {
    return ok(false);
  }

  async list(_prefix: string, _maxKeys?: number): ReturnType<StorageProvider['list']> {
    return ok([] as StorageObject[]);
  }

  async getSignedUrl(
    _key: string,
    _expiresInSeconds: number,
  ): ReturnType<StorageProvider['getSignedUrl']> {
    return ok('https://noop.invalid/signed-url');
  }

  getProviderName(): string {
    return 'noop-storage';
  }

  async getHealth(): Promise<ProviderHealth> {
    return healthyResult('No storage configured — noop provider active');
  }
}
