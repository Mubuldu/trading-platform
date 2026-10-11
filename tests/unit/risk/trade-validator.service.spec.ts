import { TradeValidatorService } from '../../../src/modules/risk/application/services/trade-validator.service';
import { RiskViolation } from '../../../src/modules/risk/domain/enums/risk-violation.enum';
import { SignalDirection } from '../../../src/modules/strategy/domain/enums/signal-direction.enum';
import { EvaluationContext } from '../../../src/modules/risk/interfaces/risk-evaluator.interface';
import { PortfolioSnapshot } from '../../../src/modules/risk/domain/models/portfolio-state.model';
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

function makePortfolio(overrides: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot {
  return {
    equity: 100_000,
    availableBalance: 50_000,
    totalExposure: 0,
    currentLeverage: 1,
    openPositions: [],
    unrealizedPnl: 0,
    snapshotAt: Date.now(),
    ...overrides,
  };
}

function makeCtx(
  overrides: Partial<{
    direction: SignalDirection;
    confidence: number;
    symbol: string;
    availableBalance: number;
  }> = {},
): EvaluationContext {
  return {
    signal: {
      signalId: 'sig-1',
      timestamp: Date.now(),
      strategyId: 'strat-1',
      exchange: 'binance',
      symbol: overrides.symbol ?? 'BTC/USDT',
      direction: overrides.direction ?? SignalDirection.BUY,
      confidence: overrides.confidence ?? 0.8,
      reason: 'test',
      metadata: {},
    },
    portfolio: makePortfolio({ availableBalance: overrides.availableBalance ?? 50_000 }),
  };
}

function makeService(cfgOverrides: Partial<RiskConfig> = {}): TradeValidatorService {
  return new TradeValidatorService(makeConfigService(makeRiskConfig(cfgOverrides)));
}

describe('TradeValidatorService', () => {
  it('passes a valid BUY signal', () => {
    const result = makeService().check(makeCtx());
    expect(result.passed).toBe(true);
  });

  it('passes HOLD as a non-error (no violations, passed=false for downstream skip)', () => {
    const result = makeService().check(makeCtx({ direction: SignalDirection.HOLD }));
    expect(result.violations).toHaveLength(0);
  });

  it('rejects blocked symbol', () => {
    const result = makeService({ blockedSymbols: ['BTC/USDT'] }).check(
      makeCtx({ symbol: 'BTC/USDT' }),
    );
    expect(result.passed).toBe(false);
    expect(result.violations).toContain(RiskViolation.BLOCKED_SYMBOL);
  });

  it('allows non-blocked symbol even when other symbols are blocked', () => {
    const result = makeService({ blockedSymbols: ['ETH/USDT'] }).check(
      makeCtx({ symbol: 'BTC/USDT' }),
    );
    expect(result.passed).toBe(true);
  });

  it('rejects confidence below threshold', () => {
    const result = makeService({ minConfidenceThreshold: 0.5 }).check(makeCtx({ confidence: 0.3 }));
    expect(result.passed).toBe(false);
    expect(result.violations).toContain(RiskViolation.CONFIDENCE_TOO_LOW);
  });

  it('passes confidence at threshold', () => {
    const result = makeService({ minConfidenceThreshold: 0.5 }).check(makeCtx({ confidence: 0.5 }));
    expect(result.passed).toBe(true);
  });

  it('rejects when no available balance', () => {
    const result = makeService().check(makeCtx({ availableBalance: 0 }));
    expect(result.passed).toBe(false);
    expect(result.violations).toContain(RiskViolation.INSUFFICIENT_BALANCE);
  });

  it('rejects when available balance is negative', () => {
    const result = makeService().check(makeCtx({ availableBalance: -100 }));
    expect(result.passed).toBe(false);
    expect(result.violations).toContain(RiskViolation.INSUFFICIENT_BALANCE);
  });
});
