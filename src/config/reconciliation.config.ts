import { registerAs } from '@nestjs/config';

export interface ReconciliationConfig {
  enabled: boolean;
  intervalMs: number;
  smallDiffAbsolute: number;
  smallDiffPercent: number;
  priceDiffPercent: number;
  pauseTradingOnMismatch: boolean;
  defaultAccountId: string;
}

export const reconciliationConfig = registerAs('reconciliation', (): ReconciliationConfig => ({
  enabled: process.env.RECONCILIATION_ENABLED !== 'false',
  intervalMs: parseInt(process.env.RECONCILIATION_INTERVAL_MS ?? '10000', 10),
  smallDiffAbsolute: parseFloat(process.env.RECONCILIATION_SMALL_DIFF_ABSOLUTE ?? '0.001'),
  smallDiffPercent: parseFloat(process.env.RECONCILIATION_SMALL_DIFF_PERCENT ?? '0.01'),
  priceDiffPercent: parseFloat(process.env.RECONCILIATION_PRICE_DIFF_PERCENT ?? '0.005'),
  pauseTradingOnMismatch: process.env.RECONCILIATION_PAUSE_ON_MISMATCH !== 'false',
  defaultAccountId: process.env.POSITION_DEFAULT_ACCOUNT_ID ?? 'default',
}));
