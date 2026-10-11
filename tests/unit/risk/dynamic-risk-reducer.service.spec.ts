import { DynamicRiskReducerService } from '../../../src/modules/risk/application/services/dynamic-risk-reducer.service';
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
    dailyTradeLimit: 100,
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

function makeCtx(volatility?: number): EvaluationContext {
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
    currentVolatility: volatility,
  };
}

function makeService(
  state: RiskStateService,
  cfgOverrides: Partial<RiskConfig> = {},
): DynamicRiskReducerService {
  return new DynamicRiskReducerService(makeConfigService(makeRiskConfig(cfgOverrides)), state);
}

describe('DynamicRiskReducerService', () => {
  it('returns factor=1 and no violations when conditions are normal', () => {
    const state = new RiskStateService();
    state.initEquity(100_000);
    const result = makeService(state).evaluate(makeCtx());
    expect(result.factor).toBe(1.0);
    expect(result.violations).toHaveLength(0);
  });

  it('reduces size when drawdown exceeds threshold', () => {
    const state = new RiskStateService();
    state.initEquity(100_000);
    state.recordTrade(-8_000);
    const result = makeService(state, {
      drawdownReductionThresholdPercent: 5,
      drawdownReductionFactor: 0.5,
    }).evaluate(makeCtx());
    expect(result.factor).toBeCloseTo(0.5);
    expect(result.violations).toContain(RiskViolation.DRAWDOWN_REDUCTION_APPLIED);
  });

  it('reduces size when consecutive losses exceed threshold', () => {
    const state = new RiskStateService();
    state.initEquity(100_000);
    for (let i = 0; i < 3; i++) state.recordTrade(-100);
    const result = makeService(state, {
      consecutiveLossReductionThreshold: 3,
      consecutiveLossReductionFactor: 0.5,
    }).evaluate(makeCtx());
    expect(result.factor).toBeCloseTo(0.5);
    expect(result.violations).toContain(RiskViolation.CONSECUTIVE_LOSS_REDUCTION_APPLIED);
  });

  it('reduces size when volatility is high — high volatility scenario', () => {
    const state = new RiskStateService();
    state.initEquity(100_000);
    const result = makeService(state, {
      volatilityReductionThresholdPercent: 30,
      volatilityReductionFactor: 0.5,
    }).evaluate(makeCtx(40));
    expect(result.factor).toBeCloseTo(0.5);
    expect(result.violations).toContain(RiskViolation.VOLATILITY_REDUCTION_APPLIED);
  });

  it('stacks all three reductions when all conditions trigger', () => {
    const state = new RiskStateService();
    state.initEquity(100_000);
    state.recordTrade(-8_000);
    for (let i = 0; i < 3; i++) state.recordTrade(-100);
    const result = makeService(state, {
      drawdownReductionThresholdPercent: 5,
      drawdownReductionFactor: 0.5,
      consecutiveLossReductionThreshold: 3,
      consecutiveLossReductionFactor: 0.5,
      volatilityReductionThresholdPercent: 30,
      volatilityReductionFactor: 0.5,
    }).evaluate(makeCtx(40));
    expect(result.factor).toBeCloseTo(0.125);
    expect(result.violations).toHaveLength(3);
  });

  it('factor never goes below 0.1 (minimum floor)', () => {
    const state = new RiskStateService();
    state.initEquity(100_000);
    state.recordTrade(-50_000);
    for (let i = 0; i < 10; i++) state.recordTrade(-1_000);
    const result = makeService(state, {
      drawdownReductionFactor: 0.01,
      consecutiveLossReductionFactor: 0.01,
      volatilityReductionFactor: 0.01,
    }).evaluate(makeCtx(100));
    expect(result.factor).toBeGreaterThanOrEqual(0.1);
  });

  it('does not reduce when volatility is below threshold', () => {
    const state = new RiskStateService();
    state.initEquity(100_000);
    const result = makeService(state, { volatilityReductionThresholdPercent: 30 }).evaluate(
      makeCtx(20),
    );
    expect(result.violations).not.toContain(RiskViolation.VOLATILITY_REDUCTION_APPLIED);
  });
});
