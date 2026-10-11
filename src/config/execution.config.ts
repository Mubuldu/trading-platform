import { registerAs } from '@nestjs/config';

export type OrderRoutingMode = 'direct' | 'smart' | 'vwap';

export interface ExecutionConfig {
  enabled: boolean;
  orderRoutingMode: OrderRoutingMode;
  slippageToleranceBps: number;
  maxSlippageBps: number;
  retryOnPartialFill: boolean;
  maxRetries: number;
  orderTimeoutMs: number;
  cancelOnTimeout: boolean;
}

export const executionConfig = registerAs('execution', (): ExecutionConfig => ({
  enabled: process.env.EXECUTION_ENABLED !== 'false',
  orderRoutingMode: (process.env.EXECUTION_ORDER_ROUTING_MODE ?? 'direct') as OrderRoutingMode,
  slippageToleranceBps: parseInt(process.env.EXECUTION_SLIPPAGE_TOLERANCE_BPS ?? '10', 10),
  maxSlippageBps: parseInt(process.env.EXECUTION_MAX_SLIPPAGE_BPS ?? '50', 10),
  retryOnPartialFill: process.env.EXECUTION_RETRY_ON_PARTIAL_FILL === 'true',
  maxRetries: parseInt(process.env.EXECUTION_MAX_RETRIES ?? '3', 10),
  orderTimeoutMs: parseInt(process.env.EXECUTION_ORDER_TIMEOUT_MS ?? '30000', 10),
  cancelOnTimeout: process.env.EXECUTION_CANCEL_ON_TIMEOUT !== 'false',
}));
