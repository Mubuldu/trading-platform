import { registerAs } from '@nestjs/config';

export interface PositionConfig {
  enabled: boolean;
  defaultAccountId: string;
  consumerGroup: string;
  cacheKeyPrefix: string;
}

export const positionConfig = registerAs('position', (): PositionConfig => ({
  enabled: process.env.POSITION_MANAGER_ENABLED !== 'false',
  defaultAccountId: process.env.POSITION_DEFAULT_ACCOUNT_ID ?? 'default',
  consumerGroup: process.env.POSITION_CONSUMER_GROUP ?? 'position-manager',
  cacheKeyPrefix: process.env.POSITION_CACHE_KEY_PREFIX ?? 'positions',
}));
