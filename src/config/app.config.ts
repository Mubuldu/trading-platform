import { registerAs } from '@nestjs/config';

export interface AppConfig {
  name: string;
  port: number;
  version: string;
  environment: 'development' | 'test' | 'staging' | 'production';
  swagger: {
    enabled: boolean;
  };
  cors: {
    origins: string[];
  };
  security: {
    apiKeySecret: string;
  };
}

export const appConfig = registerAs('app', (): AppConfig => ({
  name: process.env.APP_NAME as string,
  port: parseInt(process.env.APP_PORT as string, 10),
  version: process.env.APP_VERSION as string,
  environment: process.env.NODE_ENV as AppConfig['environment'],
  swagger: {
    enabled: process.env.SWAGGER_ENABLED === 'true',
  },
  cors: {
    origins: (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  },
  security: {
    apiKeySecret: process.env.API_KEY_SECRET as string,
  },
}));
