import { registerAs } from '@nestjs/config';

export interface PaperTradingConfig {
  enabled: boolean;
  initialBalanceUsd: number;
  resetOnRestart: boolean;

  // Slippage
  simulateSlippage: boolean;
  slippageBps: number;

  // Latency
  simulateLatency: boolean;
  latencyMs: number;
  latencyJitterMs: number;

  // Commission
  makerCommissionBps: number;
  takerCommissionBps: number;

  // Partial fills
  partialFillEnabled: boolean;
  partialFillMinFillPercent: number;

  // Funding
  fundingEnabled: boolean;
  fundingIntervalMs: number;

  // Persistence consumer group
  consumerGroup: string;
}

export const paperTradingConfig = registerAs('paperTrading', (): PaperTradingConfig => ({
  enabled: process.env.PAPER_TRADING_ENABLED === 'true',
  initialBalanceUsd: parseFloat(process.env.PAPER_TRADING_INITIAL_BALANCE_USD ?? '100000'),
  resetOnRestart: process.env.PAPER_TRADING_RESET_ON_RESTART === 'true',

  simulateSlippage: process.env.PAPER_TRADING_SIMULATE_SLIPPAGE !== 'false',
  slippageBps: parseInt(process.env.PAPER_TRADING_SLIPPAGE_BPS ?? '5', 10),

  simulateLatency: process.env.PAPER_TRADING_SIMULATE_LATENCY !== 'false',
  latencyMs: parseInt(process.env.PAPER_TRADING_LATENCY_MS ?? '50', 10),
  latencyJitterMs: parseInt(process.env.PAPER_TRADING_LATENCY_JITTER_MS ?? '20', 10),

  makerCommissionBps: parseInt(process.env.PAPER_TRADING_MAKER_COMMISSION_BPS ?? '2', 10),
  takerCommissionBps: parseInt(process.env.PAPER_TRADING_TAKER_COMMISSION_BPS ?? '5', 10),

  partialFillEnabled: process.env.PAPER_TRADING_PARTIAL_FILL_ENABLED === 'true',
  partialFillMinFillPercent: parseFloat(process.env.PAPER_TRADING_PARTIAL_FILL_MIN_PCT ?? '0.3'),

  fundingEnabled: process.env.PAPER_TRADING_FUNDING_ENABLED === 'true',
  fundingIntervalMs: parseInt(process.env.PAPER_TRADING_FUNDING_INTERVAL_MS ?? '28800000', 10), // 8h

  consumerGroup: process.env.PAPER_TRADING_CONSUMER_GROUP ?? 'paper-trading',
}));
