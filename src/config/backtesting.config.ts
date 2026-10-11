import { registerAs } from '@nestjs/config';

export interface BacktestingConfig {
  dataDir: string;
  resultsDir: string;
  defaultCommissionBps: number;
  defaultSlippageBps: number;
  defaultInitialCapitalUsd: number;
  maxWorkers: number;
}

export const backtestingConfig = registerAs('backtesting', (): BacktestingConfig => ({
  dataDir: process.env.BACKTESTING_DATA_DIR ?? './data/backtesting',
  resultsDir: process.env.BACKTESTING_RESULTS_DIR ?? './data/results',
  defaultCommissionBps: parseInt(process.env.BACKTESTING_DEFAULT_COMMISSION_BPS ?? '10', 10),
  defaultSlippageBps: parseInt(process.env.BACKTESTING_DEFAULT_SLIPPAGE_BPS ?? '5', 10),
  defaultInitialCapitalUsd: parseFloat(
    process.env.BACKTESTING_DEFAULT_INITIAL_CAPITAL_USD ?? '100000',
  ),
  maxWorkers: parseInt(process.env.BACKTESTING_MAX_WORKERS ?? '4', 10),
}));
