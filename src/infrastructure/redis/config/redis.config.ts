import { registerAs } from '@nestjs/config';

export interface RedisConfig {
  url: string;
  password: string;
  keyPrefix: string;
  streams: {
    maxLen: number;
    approximateMaxLen: boolean;
  };
  consumer: {
    blockTimeoutMs: number;
    batchSize: number;
    maxRetries: number;
    processingTimeoutMs: number;
    pendingRecoveryIntervalMs: number;
    idleConsumerTimeoutMs: number;
  };
  reconnect: {
    maxRetries: number;
    retryDelayMs: number;
    maxRetryDelayMs: number;
  };
  health: {
    checkIntervalMs: number;
    latencyWarnThresholdMs: number;
  };
}

export const redisConfig = registerAs('redis', (): RedisConfig => ({
  url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  password: process.env.REDIS_PASSWORD ?? '',
  keyPrefix: process.env.REDIS_KEY_PREFIX ?? 'tp:',
  streams: {
    maxLen: parseInt(process.env.REDIS_STREAM_MAXLEN ?? '100000', 10),
    approximateMaxLen: process.env.REDIS_STREAM_APPROX_MAXLEN !== 'false',
  },
  consumer: {
    blockTimeoutMs: parseInt(process.env.REDIS_CONSUMER_BLOCK_TIMEOUT_MS ?? '2000', 10),
    batchSize: parseInt(process.env.REDIS_CONSUMER_BATCH_SIZE ?? '10', 10),
    maxRetries: parseInt(process.env.REDIS_CONSUMER_MAX_RETRIES ?? '3', 10),
    processingTimeoutMs: parseInt(process.env.REDIS_CONSUMER_PROCESSING_TIMEOUT_MS ?? '30000', 10),
    pendingRecoveryIntervalMs: parseInt(
      process.env.REDIS_CONSUMER_PENDING_RECOVERY_INTERVAL_MS ?? '60000',
      10,
    ),
    idleConsumerTimeoutMs: parseInt(process.env.REDIS_CONSUMER_IDLE_TIMEOUT_MS ?? '300000', 10),
  },
  reconnect: {
    maxRetries: parseInt(process.env.REDIS_RECONNECT_MAX_RETRIES ?? '20', 10),
    retryDelayMs: parseInt(process.env.REDIS_RECONNECT_DELAY_MS ?? '1000', 10),
    maxRetryDelayMs: parseInt(process.env.REDIS_RECONNECT_MAX_DELAY_MS ?? '30000', 10),
  },
  health: {
    checkIntervalMs: parseInt(process.env.REDIS_HEALTH_CHECK_INTERVAL_MS ?? '30000', 10),
    latencyWarnThresholdMs: parseInt(process.env.REDIS_HEALTH_LATENCY_WARN_MS ?? '100', 10),
  },
}));
