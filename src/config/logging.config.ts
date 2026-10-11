import { registerAs } from '@nestjs/config';

export interface LoggingConfig {
  level: string;
  dir: string;
  maxFileSizeMb: number;
  maxFiles: string;
  errorMaxFiles: string;
  enableConsole: boolean;
  jsonOutput: boolean;
}

export const loggingConfig = registerAs('logging', (): LoggingConfig => ({
  level: process.env.LOG_LEVEL ?? 'info',
  dir: process.env.LOG_DIR ?? './logs',
  maxFileSizeMb: parseInt(process.env.LOG_MAX_FILE_SIZE_MB ?? '50', 10),
  maxFiles: process.env.LOG_MAX_FILES ?? '30d',
  errorMaxFiles: process.env.LOG_ERROR_MAX_FILES ?? '90d',
  enableConsole: process.env.LOG_CONSOLE_ENABLED !== 'false',
  jsonOutput: process.env.LOG_JSON_OUTPUT === 'true',
}));
