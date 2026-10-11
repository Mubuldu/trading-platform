import { PortfolioLimitsService } from '../../../src/modules/risk/application/services/portfolio-limits.service';
import { RiskViolation } from '../../../src/modules/risk/domain/enums/risk-violation.enum';
import { SignalDirection } from '../../../src/modules/strategy/domain/enums/signal-direction.enum';
import { EvaluationContext } from '../../../src/modules/risk/interfaces/risk-evaluator.interface';
import {
  PortfolioSnapshot,
  OpenPositionSnapshot,
} from '../../../src/modules/risk/domain/models/portfolio-state.model';
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
    maxOpenOrders: 5,
    maxPositionsPerSymbol: 2,
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

function makePos(symbol: string, notionalValue: number): OpenPositionSnapshot {
  return { symbol, side: 'LONG', quantity: 1, notionalValue, unrealizedPnl: 0, leverage: 1 };
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

function makeCtx(portfolio: PortfolioSnapshot, symbol = 'BTC/USDT'): EvaluationContext {
  return {
    signal: {
      signalId: 'sig-1',
      timestamp: Date.now(),
      strategyId: 'strat-1',
      exchange: 'binance',
      symbol,
      direction: SignalDirection.BUY,
      confidence: 0.8,
      reason: 'test',
      metadata: {},
    },
    portfolio,
  };
}

function makeService(cfgOverrides: Partial<RiskConfig> = {}): PortfolioLimitsService {
  return new PortfolioLimitsService(makeConfigService(makeRiskConfig(cfgOverrides)));
}

describe('PortfolioLimitsService', () => {
  it('passes clean portfolio', () => {
    const result = makeService().check(makeCtx(makePortfolio()));
    expect(result.passed).toBe(true);
  });

  it('rejects when exposure exceeds limit', () => {
    const portfolio = makePortfolio({ totalExposure: 85_000, equity: 100_000 });
    const result = makeService({ maxExposurePercent: 80 }).check(makeCtx(portfolio));
    expect(result.passed).toBe(false);
    expect(result.violations).toContain(RiskViolation.MAX_EXPOSURE_EXCEEDED);
  });

  it('passes when exposure is exactly at limit', () => {
    const portfolio = makePortfolio({ totalExposure: 79_999, equity: 100_000 });
    const result = makeService({ maxExposurePercent: 80 }).check(makeCtx(portfolio));
    expect(result.passed).toBe(true);
  });

  it('rejects when leverage exceeds limit', () => {
    const portfolio = makePortfolio({ currentLeverage: 4 });
    const result = makeService({ maxLeverage: 3 }).check(makeCtx(portfolio));
    expect(result.passed).toBe(false);
    expect(result.violations).toContain(RiskViolation.MAX_LEVERAGE_EXCEEDED);
  });

  it('rejects when open positions at limit', () => {
    const positions = [
      makePos('BTC/USDT', 10_000),
      makePos('ETH/USDT', 10_000),
      makePos('SOL/USDT', 10_000),
      makePos('ADA/USDT', 10_000),
      makePos('DOT/USDT', 10_000),
    ];
    const portfolio = makePortfolio({ openPositions: positions });
    const result = makeService({ maxOpenOrders: 5 }).check(makeCtx(portfolio));
    expect(result.passed).toBe(false);
    expect(result.violations).toContain(RiskViolation.MAX_OPEN_POSITIONS_EXCEEDED);
  });

  it('rejects when per-symbol limit reached', () => {
    const positions = [makePos('BTC/USDT', 10_000), makePos('BTC/USDT', 10_000)];
    const portfolio = makePortfolio({ openPositions: positions });
    const result = makeService({ maxPositionsPerSymbol: 2 }).check(makeCtx(portfolio, 'BTC/USDT'));
    expect(result.passed).toBe(false);
    expect(result.violations).toContain(RiskViolation.MAX_POSITIONS_PER_SYMBOL_EXCEEDED);
  });

  it('allows new position in different symbol when per-symbol limit reached for another', () => {
    const positions = [makePos('BTC/USDT', 10_000), makePos('BTC/USDT', 10_000)];
    const portfolio = makePortfolio({ openPositions: positions });
    const result = makeService({ maxPositionsPerSymbol: 2 }).check(makeCtx(portfolio, 'ETH/USDT'));
    expect(result.passed).toBe(true);
  });

  it('rejects when symbol concentration exceeds limit', () => {
    const positions = [makePos('BTC/USDT', 35_000)];
    const portfolio = makePortfolio({ openPositions: positions, equity: 100_000 });
    const result = makeService({ maxConcentrationPercent: 30 }).check(
      makeCtx(portfolio, 'BTC/USDT'),
    );
    expect(result.passed).toBe(false);
  });
});
