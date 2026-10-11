import { Result } from '@common/result';
import { BaseError } from '@common/errors/base.error';
import { HealthCheckable } from '@infrastructure/health/health-check.interface';

/**
 * SecretsProvider centralizes secret retrieval from external vaults.
 *
 * In development: reads from environment variables (EnvSecretsProvider).
 * In production: reads from AWS Secrets Manager, HashiCorp Vault, or
 * Azure Key Vault — the implementation changes, the interface never does.
 *
 * Rules for secret usage:
 *  - Retrieve secrets at startup (never at request time)
 *  - Cache retrieved values in memory for the process lifetime
 *  - Never log secret values — log only key names
 *  - Rotate secrets without redeployment (future: watch for rotation events)
 *
 * get() returns null for missing optional secrets.
 * getRequired() returns an error for missing mandatory secrets,
 * causing startup to abort (safe fail).
 */
export interface SecretsProvider extends HealthCheckable {
  get(key: string): Promise<Result<string | null, BaseError>>;
  getRequired(key: string): Promise<Result<string, BaseError>>;
  getAll(prefix?: string): Promise<Result<Record<string, string>, BaseError>>;
  getProviderName(): string;
}
