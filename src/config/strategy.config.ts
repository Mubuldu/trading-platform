import { registerAs } from '@nestjs/config';

export interface StrategyConfig {
  enabledIds: string[];
  defaultSymbol: string;
  maxConcurrent: number;
  heartbeatIntervalMs: number;
  orderCooldownMs: number;
}

export const strategyConfig = registerAs('strategy', (): StrategyConfig => ({
  enabledIds: (process.env.STRATEGY_ENABLED_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  defaultSymbol: process.env.STRATEGY_DEFAULT_SYMBOL ?? 'BTC/USDT',
  maxConcurrent: parseInt(process.env.STRATEGY_MAX_CONCURRENT ?? '5', 10),
  heartbeatIntervalMs: parseInt(process.env.STRATEGY_HEARTBEAT_INTERVAL_MS ?? '5000', 10),
  orderCooldownMs: parseInt(process.env.STRATEGY_ORDER_COOLDOWN_MS ?? '1000', 10),
}));
