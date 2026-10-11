import { Injectable } from '@nestjs/common';
import { readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { ok, err } from '@common/result';
import { ConfigurationError } from '@common/errors/application.error';
import {
  ProviderHealth,
  healthyResult,
  unhealthyResult,
} from '@infrastructure/health/health-check.interface';
import { SecretsProvider } from './secrets-provider.interface';

/**
 * DockerSecretsProvider reads secrets from the Docker secrets filesystem mount.
 *
 * Docker Swarm and Docker Compose (secrets:) both mount secret files at
 * /run/secrets/<secret_name> inside the container. The file name is the
 * secret name; the file content (trimmed) is the secret value.
 *
 * Key resolution order:
 *   1. Exact key name as given
 *   2. Lowercase version of the key
 *   3. Uppercase version of the key
 *
 * This order handles both lowercase Docker secret names (preferred convention)
 * and SCREAMING_SNAKE_CASE environment-style names.
 *
 * Security guarantees:
 *   - Secret values are NEVER logged — only key names appear in logs
 *   - File content is read synchronously at call time (not cached in memory
 *     beyond the call) so secret rotation takes effect on the next read
 *   - Trailing newlines and whitespace are stripped from file content
 *
 * Production use:
 *   Set SECRETS_PROVIDER=docker in the environment. Ensure Docker secrets
 *   are mounted at DOCKER_SECRETS_PATH (default: /run/secrets).
 */
@Injectable()
export class DockerSecretsProvider implements SecretsProvider {
  constructor(private readonly secretsPath: string = '/run/secrets') {}

  async get(key: string): ReturnType<SecretsProvider['get']> {
    const candidates = [key, key.toLowerCase(), key.toUpperCase()];
    for (const candidate of candidates) {
      const filePath = join(this.secretsPath, candidate);
      if (existsSync(filePath)) {
        try {
          const value = readFileSync(filePath, 'utf-8').trim();
          return ok(value || null);
        } catch (fsErr) {
          const msg = fsErr instanceof Error ? fsErr.message : String(fsErr);
          return err(
            new ConfigurationError(`Failed to read Docker secret file for key "${key}": ${msg}`, {
              key,
              path: filePath,
            }),
          );
        }
      }
    }
    return ok(null);
  }

  async getRequired(key: string): ReturnType<SecretsProvider['getRequired']> {
    const result = await this.get(key);
    if (result.isErr()) return err(result.error);
    const value = result.value;
    if (value === null || value === '') {
      return err(
        new ConfigurationError(
          `Required Docker secret "${key}" not found in "${this.secretsPath}". ` +
            `Ensure the secret is mounted at ${join(this.secretsPath, key.toLowerCase())}.`,
          { key, secretsPath: this.secretsPath },
        ),
      );
    }
    return ok(value);
  }

  async getAll(prefix?: string): ReturnType<SecretsProvider['getAll']> {
    if (!existsSync(this.secretsPath)) {
      return ok({});
    }

    const result: Record<string, string> = {};
    try {
      const { readdirSync } = await import('fs');
      const entries = readdirSync(this.secretsPath);
      for (const name of entries) {
        const filePath = join(this.secretsPath, name);
        if (!statSync(filePath).isFile()) continue;
        if (prefix && !name.toLowerCase().startsWith(prefix.toLowerCase())) continue;
        try {
          const value = readFileSync(filePath, 'utf-8').trim();
          if (value) {
            result[name] = value;
          }
        } catch {
          // Skip unreadable files — individual failures should not abort bulk retrieval
        }
      }
    } catch (fsErr) {
      const msg = fsErr instanceof Error ? fsErr.message : String(fsErr);
      return err(
        new ConfigurationError(
          `Failed to list Docker secrets directory "${this.secretsPath}": ${msg}`,
          {
            secretsPath: this.secretsPath,
          },
        ),
      );
    }

    return ok(result);
  }

  getProviderName(): string {
    return 'docker-secrets';
  }

  async getHealth(): Promise<ProviderHealth> {
    if (!existsSync(this.secretsPath)) {
      return unhealthyResult(`Docker secrets directory not found: ${this.secretsPath}`);
    }

    try {
      const { readdirSync } = await import('fs');
      const count = readdirSync(this.secretsPath).length;
      return healthyResult(
        `Docker secrets mounted at ${this.secretsPath} — ${count} secret(s) available`,
      );
    } catch (fsErr) {
      const msg = fsErr instanceof Error ? fsErr.message : String(fsErr);
      return unhealthyResult(`Docker secrets directory unreadable: ${msg}`);
    }
  }
}
