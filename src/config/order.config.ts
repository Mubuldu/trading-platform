import { registerAs } from '@nestjs/config';

export interface OrderConfig {
  enabled: boolean;
  defaultAccountId: string;
  consumerGroup: string;
  cacheKeyPrefix: string;
  pendingTimeoutMs: number;
  ackTimeoutMs: number;
  fillTimeoutMs: number;
  timeoutCheckIntervalMs: number;
}

export const orderConfig = registerAs('order', (): OrderConfig => ({
  enabled: process.env.ORDER_MANAGER_ENABLED !== 'false',
  defaultAccountId: process.env.ORDER_DEFAULT_ACCOUNT_ID ?? 'default',
  consumerGroup: process.env.ORDER_CONSUMER_GROUP ?? 'order-manager',
  cacheKeyPrefix: process.env.ORDER_CACHE_KEY_PREFIX ?? 'orders',
  pendingTimeoutMs: parseInt(process.env.ORDER_PENDING_TIMEOUT_MS ?? '30000', 10),
  ackTimeoutMs: parseInt(process.env.ORDER_ACK_TIMEOUT_MS ?? '10000', 10),
  fillTimeoutMs: parseInt(process.env.ORDER_FILL_TIMEOUT_MS ?? '300000', 10),
  timeoutCheckIntervalMs: parseInt(process.env.ORDER_TIMEOUT_CHECK_INTERVAL_MS ?? '5000', 10),
}));
