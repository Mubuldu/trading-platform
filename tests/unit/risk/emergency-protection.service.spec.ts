import { EmergencyProtectionService } from '../../../src/modules/risk/application/services/emergency-protection.service';
import { RiskStateService } from '../../../src/modules/risk/application/services/risk-state.service';
import { RiskViolation } from '../../../src/modules/risk/domain/enums/risk-violation.enum';
import { SignalDirection } from '../../../src/modules/strategy/domain/enums/signal-direction.enum';
import { EvaluationContext } from '../../../src/modules/risk/interfaces/risk-evaluator.interface';
import { PortfolioSnapshot } from '../../../src/modules/risk/domain/models/portfolio-state.model';

function makePortfolio(): PortfolioSnapshot {
  return {
    equity: 100_000,
    availableBalance: 100_000,
    totalExposure: 0,
    currentLeverage: 1,
    openPositions: [],
    unrealizedPnl: 0,
    snapshotAt: Date.now(),
  };
}

function makeCtx(direction: SignalDirection = SignalDirection.BUY): EvaluationContext {
  return {
    signal: {
      signalId: 'sig-1',
      timestamp: Date.now(),
      strategyId: 'strat-1',
      exchange: 'binance',
      symbol: 'BTC/USDT',
      direction,
      confidence: 0.8,
      reason: 'test',
      metadata: {},
    },
    portfolio: makePortfolio(),
  };
}

function makeService(): EmergencyProtectionService {
  return new EmergencyProtectionService(new RiskStateService());
}

function makeServiceWithState(state: RiskStateService): EmergencyProtectionService {
  return new EmergencyProtectionService(state);
}

describe('EmergencyProtectionService', () => {
  it('passes when no emergency conditions are active', () => {
    const result = makeService().check(makeCtx());
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('blocks when kill switch is active', () => {
    const state = new RiskStateService();
    state.triggerKillSwitch();
    const svc = makeServiceWithState(state);
    const result = svc.check(makeCtx());
    expect(result.passed).toBe(false);
    expect(result.violations).toContain(RiskViolation.KILL_SWITCH_ACTIVE);
  });

  it('blocks when trading is paused', () => {
    const state = new RiskStateService();
    state.pauseTrading();
    const svc = makeServiceWithState(state);
    const result = svc.check(makeCtx());
    expect(result.passed).toBe(false);
    expect(result.violations).toContain(RiskViolation.TRADING_PAUSED);
  });

  it('blocks BUY when exposure is locked', () => {
    const state = new RiskStateService();
    state.lockExposure();
    const svc = makeServiceWithState(state);
    const result = svc.check(makeCtx(SignalDirection.BUY));
    expect(result.passed).toBe(false);
    expect(result.violations).toContain(RiskViolation.EXPOSURE_LOCKED);
  });

  it('blocks SELL when exposure is locked', () => {
    const state = new RiskStateService();
    state.lockExposure();
    const svc = makeServiceWithState(state);
    const result = svc.check(makeCtx(SignalDirection.SELL));
    expect(result.passed).toBe(false);
    expect(result.violations).toContain(RiskViolation.EXPOSURE_LOCKED);
  });

  it('passes EXIT when exposure is locked (reducing, not increasing)', () => {
    const state = new RiskStateService();
    state.lockExposure();
    const svc = makeServiceWithState(state);
    const result = svc.check(makeCtx(SignalDirection.EXIT));
    expect(result.passed).toBe(true);
  });

  it('kill switch takes priority over trading paused', () => {
    const state = new RiskStateService();
    state.triggerKillSwitch();
    state.pauseTrading();
    const svc = makeServiceWithState(state);
    const result = svc.check(makeCtx());
    expect(result.violations).toContain(RiskViolation.KILL_SWITCH_ACTIVE);
    expect(result.violations).not.toContain(RiskViolation.TRADING_PAUSED);
  });
});
