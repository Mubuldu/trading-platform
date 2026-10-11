import { registerAs } from '@nestjs/config';
import { AllocationMethod } from '@modules/portfolio/domain/enums/allocation-method.enum';

export interface PortfolioConfig {
  enabled: boolean;
  consumerGroup: string;
  defaultEquityUsd: number;
  defaultAccountId: string;

  allocationMethod: AllocationMethod;
  maxPositionSizePercent: number;

  maxExposurePercent: number;
  maxLeverage: number;
  maxCorrelationThreshold: number;
  maxAssetAllocationPercent: number;

  rollingDrawdownWindowDays: number;
  riskFreeRateAnnual: number;
  tradingDaysPerYear: number;

  snapshotIntervalMs: number;
  metricsRetentionDays: number;
}

export const portfolioConfig = registerAs('portfolio', (): PortfolioConfig => ({
  enabled: process.env.PORTFOLIO_MANAGER_ENABLED !== 'false',
  consumerGroup: process.env.PORTFOLIO_CONSUMER_GROUP ?? 'portfolio-manager',
  defaultEquityUsd: parseFloat(process.env.PORTFOLIO_DEFAULT_EQUITY_USD ?? '100000'),
  defaultAccountId: process.env.PORTFOLIO_DEFAULT_ACCOUNT_ID ?? 'default',

  allocationMethod:
    (process.env.PORTFOLIO_ALLOCATION_METHOD as AllocationMethod) ?? AllocationMethod.EQUAL_WEIGHT,
  maxPositionSizePercent: parseFloat(process.env.PORTFOLIO_MAX_POSITION_SIZE_PERCENT ?? '20'),

  maxExposurePercent: parseFloat(process.env.PORTFOLIO_MAX_EXPOSURE_PERCENT ?? '80'),
  maxLeverage: parseFloat(process.env.PORTFOLIO_MAX_LEVERAGE ?? '3'),
  maxCorrelationThreshold: parseFloat(process.env.PORTFOLIO_MAX_CORRELATION ?? '0.8'),
  maxAssetAllocationPercent: parseFloat(process.env.PORTFOLIO_MAX_ASSET_ALLOCATION_PERCENT ?? '40'),

  rollingDrawdownWindowDays: parseInt(process.env.PORTFOLIO_ROLLING_DRAWDOWN_DAYS ?? '30', 10),
  riskFreeRateAnnual: parseFloat(process.env.PORTFOLIO_RISK_FREE_RATE ?? '0.05'),
  tradingDaysPerYear: parseInt(process.env.PORTFOLIO_TRADING_DAYS_PER_YEAR ?? '252', 10),

  snapshotIntervalMs: parseInt(process.env.PORTFOLIO_SNAPSHOT_INTERVAL_MS ?? '3600000', 10),
  metricsRetentionDays: parseInt(process.env.PORTFOLIO_METRICS_RETENTION_DAYS ?? '365', 10),
}));
