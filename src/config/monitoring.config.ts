import { registerAs } from '@nestjs/config';

export interface MonitoringConfig {
  metrics: {
    enabled: boolean;
    prefix: string;
    collectionIntervalMs: number;
  };
  thresholds: {
    latencyWarnMs: number;
    errorRateWarnPercent: number;
    memoryWarnPercent: number;
    cpuWarnPercent: number;
  };
}

export const monitoringConfig = registerAs('monitoring', (): MonitoringConfig => ({
  metrics: {
    enabled: process.env.METRICS_ENABLED !== 'false',
    prefix: process.env.METRICS_PREFIX ?? 'trading_platform',
    collectionIntervalMs: parseInt(process.env.METRICS_COLLECTION_INTERVAL_MS ?? '15000', 10),
  },
  thresholds: {
    latencyWarnMs: parseInt(process.env.MONITORING_LATENCY_WARN_MS ?? '100', 10),
    errorRateWarnPercent: parseFloat(process.env.MONITORING_ERROR_RATE_WARN_PERCENT ?? '5'),
    memoryWarnPercent: parseFloat(process.env.MONITORING_MEMORY_WARN_PERCENT ?? '80'),
    cpuWarnPercent: parseFloat(process.env.MONITORING_CPU_WARN_PERCENT ?? '80'),
  },
}));
