import { DailyLimitsService } from '../../../src/modules/risk/application/services/daily-limits.service';
import { RiskStateService } from '../../../src/modules/risk/application/services/risk-state.service';
import { RiskViolation } from '../../../src/modules/risk/domain/enums/risk-violation.enum';
import { SignalDirection } from '../../../src/modules/strategy/domain/enums/signal-direction.enum';
import { EvaluationContext } from '../../../src/modules/risk/interfaces/risk-evaluator.interface';
import { RiskConfig } from '../../../src/config/risk.config';

function makeRiskConfig(overrides: Partial<RiskConfig> = {}): RiskConfig {
  return {
    enabled: true,
    defaultEquityUsd: 100_000,
    sizingMethod: 'FIXED_FRACTIONAL',
    riskPerTradePercent: 1,
    maxPositionSizeUsd: 100_000,
    maxOrderSizeUsd: 10_000,
    atrMultiplier: 2,
    kellyFractionMultiplier: 0.25,
    targetVolatilityPercent: 15,
    maxExposurePercent: 80,
    maxLeverage: 3,
    maxOpenOrders: 50,
    maxPositionsPerSymbol: 3,
    maxConcentrationPercent: 30,
    maxDailyLossUsd: 5_000,
    maxDrawdownPercent: 10,
    maxConsecutiveLosses: 5,
    dailyTradeLimit: 10,
    minConfidenceThreshold: 0.3,
    blockedSymbols: [],
    drawdownReductionThresholdPercent: 5,
    drawdownReductionFactor: 0.5,
    consecutiveLossReductionThreshold: 3,
    consecutiveLossReductionFactor: 0.5,
    volatilityReductionThresholdPercent: 30,
    volatilityReductionFactor: 0.5,
    ...overrides,
  };
}

function makeConfigService(cfg: RiskConfig): any {
  return { get: (_key: string) => cfg };
}

function makeCtx(): EvaluationContext {
  return {
    signal: {
      signalId: 'sig-1',
      timestamp: Date.now(),
      strategyId: 'strat-1',
      exchange: 'binance',
      symbol: 'BTC/USDT',
      direction: SignalDirection.BUY,
      confidence: 0.8,
      reason: 'test',
      metadata: {},
    },
    portfolio: {
      equity: 100_000,
      availableBalance: 50_000,
      totalExposure: 0,
      currentLeverage: 1,
      openPositions: [],
      unrealizedPnl: 0,
      snapshotAt: Date.now(),
    },
  };
}

function makeService(
  state: RiskStateService,
  cfgOverrides: Partial<RiskConfig> = {},
): DailyLimitsService {
  return new DailyLimitsService(makeConfigService(makeRiskConfig(cfgOverrides)), state);
}

describe('DailyLimitsService', () => {
  it('passes when all daily limits are within bounds', () => {
    const state = new RiskStateService();
    state.initEquity(100_000);
    const result = makeService(state).check(makeCtx());
    expect(result.passed).toBe(true);
  });

  it('rejects when daily loss reaches limit', () => {
    const state = new RiskStateService();
    state.initEquity(100_000);
    state.recordTrade(-5_000);
    const result = makeService(state, { maxDailyLossUsd: 5_000 }).check(makeCtx());
    expect(result.passed).toBe(false);
    expect(result.violations).toContain(RiskViolation.MAX_DAILY_LOSS_EXCEEDED);
  });

  it('passes when daily loss is just below limit', () => {
    const state = new RiskStateService();
    state.initEquity(100_000);
    state.recordTrade(-4_999);
    const result = makeService(state, { maxDailyLossUsd: 5_000 }).check(makeCtx());
    expect(result.passed).toBe(true);
  });

  it('rejects on maximum drawdown — flash crash scenario', () => {
    const state = new RiskStateService();
    state.initEquity(100_000);
    state.recordTrade(-15_000);
    // maxDailyLossUsd must be high enough so daily loss check passes and drawdown check fires
    const result = makeService(state, { maxDrawdownPercent: 10, maxDailyLossUsd: 1_000_000 }).check(
      makeCtx(),
    );
    expect(result.passed).toBe(false);
    expect(result.violations).toContain(RiskViolation.MAX_DRAWDOWN_EXCEEDED);
  });

  it('rejects when consecutive losses reach limit — losing streak', () => {
    const state = new RiskStateService();
    state.initEquity(100_000);
    for (let i = 0; i < 5; i++) state.recordTrade(-200);
    const result = makeService(state, { maxConsecutiveLosses: 5 }).check(makeCtx());
    expect(result.passed).toBe(false);
    expect(result.violations).toContain(RiskViolation.MAX_CONSECUTIVE_LOSSES_EXCEEDED);
  });

  it('passes after winning streak even with prior losses', () => {
    const state = new RiskStateService();
    state.initEquity(100_000);
    for (let i = 0; i < 4; i++) state.recordTrade(-200);
    state.recordTrade(100);
    const result = makeService(state, { maxConsecutiveLosses: 5 }).check(makeCtx());
    expect(result.passed).toBe(true);
  });

  it('rejects when daily trade limit is reached', () => {
    const state = new RiskStateService();
    state.initEquity(100_000);
    for (let i = 0; i < 10; i++) state.recordTrade(100);
    const result = makeService(state, { dailyTradeLimit: 10 }).check(makeCtx());
    expect(result.passed).toBe(false);
    expect(result.violations).toContain(RiskViolation.DAILY_TRADE_LIMIT_EXCEEDED);
  });
});
