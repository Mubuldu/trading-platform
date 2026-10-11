import { registerAs } from '@nestjs/config';

export interface RiskConfig {
  enabled: boolean;

  // ── Account defaults (used until execution module provides live data) ──────
  defaultEquityUsd: number;

  // ── Position sizing ───────────────────────────────────────────────────────
  sizingMethod: 'FIXED_FRACTIONAL' | 'ATR' | 'FRACTIONAL_KELLY' | 'VOLATILITY_TARGETING';
  riskPerTradePercent: number;
  maxPositionSizeUsd: number;
  maxOrderSizeUsd: number;
  atrMultiplier: number;
  kellyFractionMultiplier: number;
  targetVolatilityPercent: number;

  // ── Portfolio limits ──────────────────────────────────────────────────────
  maxExposurePercent: number;
  maxLeverage: number;
  maxOpenOrders: number;
  maxPositionsPerSymbol: number;
  maxConcentrationPercent: number;

  // ── Daily limits ──────────────────────────────────────────────────────────
  maxDailyLossUsd: number;
  maxDrawdownPercent: number;
  maxConsecutiveLosses: number;
  dailyTradeLimit: number;

  // ── Trade validation ──────────────────────────────────────────────────────
  minConfidenceThreshold: number;
  blockedSymbols: string[];

  // ── Dynamic risk reduction ────────────────────────────────────────────────
  drawdownReductionThresholdPercent: number;
  drawdownReductionFactor: number;
  consecutiveLossReductionThreshold: number;
  consecutiveLossReductionFactor: number;
  volatilityReductionThresholdPercent: number;
  volatilityReductionFactor: number;
}

export const riskConfig = registerAs('risk', (): RiskConfig => ({
  enabled: process.env.RISK_ENABLED !== 'false',

  defaultEquityUsd: parseFloat(process.env.RISK_DEFAULT_EQUITY_USD ?? '100000'),

  sizingMethod:
    (process.env.RISK_SIZING_METHOD as RiskConfig['sizingMethod']) ?? 'FIXED_FRACTIONAL',
  riskPerTradePercent: parseFloat(process.env.RISK_PER_TRADE_PERCENT ?? '1'),
  maxPositionSizeUsd: parseFloat(process.env.RISK_MAX_POSITION_SIZE_USD ?? '100000'),
  maxOrderSizeUsd: parseFloat(process.env.RISK_MAX_ORDER_SIZE_USD ?? '10000'),
  atrMultiplier: parseFloat(process.env.RISK_ATR_MULTIPLIER ?? '2'),
  kellyFractionMultiplier: parseFloat(process.env.RISK_KELLY_FRACTION_MULTIPLIER ?? '0.25'),
  targetVolatilityPercent: parseFloat(process.env.RISK_TARGET_VOLATILITY_PERCENT ?? '15'),

  maxExposurePercent: parseFloat(process.env.RISK_MAX_EXPOSURE_PERCENT ?? '80'),
  maxLeverage: parseFloat(process.env.RISK_MAX_LEVERAGE ?? '3'),
  maxOpenOrders: parseInt(process.env.RISK_MAX_OPEN_ORDERS ?? '50', 10),
  maxPositionsPerSymbol: parseInt(process.env.RISK_MAX_POSITIONS_PER_SYMBOL ?? '3', 10),
  maxConcentrationPercent: parseFloat(process.env.RISK_MAX_CONCENTRATION_PERCENT ?? '30'),

  maxDailyLossUsd: parseFloat(process.env.RISK_MAX_DAILY_LOSS_USD ?? '5000'),
  maxDrawdownPercent: parseFloat(process.env.RISK_MAX_DRAWDOWN_PERCENT ?? '10'),
  maxConsecutiveLosses: parseInt(process.env.RISK_MAX_CONSECUTIVE_LOSSES ?? '5', 10),
  dailyTradeLimit: parseInt(process.env.RISK_DAILY_TRADE_LIMIT ?? '100', 10),

  minConfidenceThreshold: parseFloat(process.env.RISK_MIN_CONFIDENCE ?? '0.3'),
  blockedSymbols: (process.env.RISK_BLOCKED_SYMBOLS ?? '').split(',').filter(Boolean),

  drawdownReductionThresholdPercent: parseFloat(
    process.env.RISK_DRAWDOWN_REDUCTION_THRESHOLD ?? '5',
  ),
  drawdownReductionFactor: parseFloat(process.env.RISK_DRAWDOWN_REDUCTION_FACTOR ?? '0.5'),
  consecutiveLossReductionThreshold: parseInt(
    process.env.RISK_CONSECUTIVE_LOSS_REDUCTION_THRESHOLD ?? '3',
    10,
  ),
  consecutiveLossReductionFactor: parseFloat(
    process.env.RISK_CONSECUTIVE_LOSS_REDUCTION_FACTOR ?? '0.5',
  ),
  volatilityReductionThresholdPercent: parseFloat(
    process.env.RISK_VOLATILITY_REDUCTION_THRESHOLD ?? '30',
  ),
  volatilityReductionFactor: parseFloat(process.env.RISK_VOLATILITY_REDUCTION_FACTOR ?? '0.5'),
}));
