import { registerAs } from '@nestjs/config';

export type SecretsProviderType = 'env' | 'docker';

export interface SecretsConfig {
  provider: SecretsProviderType;
  dockerSecretsPath: string;
}

export const secretsConfig = registerAs('secrets', (): SecretsConfig => ({
  provider: (process.env.SECRETS_PROVIDER ?? 'env') as SecretsProviderType,
  dockerSecretsPath: process.env.DOCKER_SECRETS_PATH ?? '/run/secrets',
}));
