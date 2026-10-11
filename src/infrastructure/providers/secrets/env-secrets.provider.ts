import { Injectable } from '@nestjs/common';
import { ok, err } from '@common/result';
import { ConfigurationError } from '@common/errors/application.error';
import { healthyResult, ProviderHealth } from '@infrastructure/health/health-check.interface';
import { SecretsProvider } from './secrets-provider.interface';

/**
 * EnvSecretsProvider reads secrets from environment variables.
 *
 * This is the development/testing implementation. In production, replace
 * with AwsSecretsManagerProvider, HashiCorpVaultProvider, or
 * AzureKeyVaultProvider. The calling code never changes.
 *
 * Security notes:
 *  - Never log secret values — log key names only
 *  - Environment variables are readable by any code in the process;
 *    use a proper vault in production to restrict access
 */
@Injectable()
export class EnvSecretsProvider implements SecretsProvider {
  async get(key: string): ReturnType<SecretsProvider['get']> {
    const value = process.env[key] ?? null;
    return ok(value);
  }

  async getRequired(key: string): ReturnType<SecretsProvider['getRequired']> {
    const value = process.env[key];
    if (!value || value.trim() === '') {
      return err(
        new ConfigurationError(`Required secret "${key}" is not set in environment`, { key }),
      );
    }
    return ok(value);
  }

  async getAll(prefix?: string): ReturnType<SecretsProvider['getAll']> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue;
      if (prefix && !key.startsWith(prefix)) continue;
      result[key] = value;
    }
    return ok(result);
  }

  getProviderName(): string {
    return 'env-secrets';
  }

  async getHealth(): Promise<ProviderHealth> {
    return healthyResult('env-secrets — reading from process environment');
  }
}
