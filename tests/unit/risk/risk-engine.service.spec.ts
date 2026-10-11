import { RiskEngineService } from '../../../src/modules/risk/application/services/risk-engine.service';
import { RiskStateService } from '../../../src/modules/risk/application/services/risk-state.service';
import { EmergencyProtectionService } from '../../../src/modules/risk/application/services/emergency-protection.service';
import { TradeValidatorService } from '../../../src/modules/risk/application/services/trade-validator.service';
import { PortfolioLimitsService } from '../../../src/modules/risk/application/services/portfolio-limits.service';
import { DailyLimitsService } from '../../../src/modules/risk/application/services/daily-limits.service';
import { DynamicRiskReducerService } from '../../../src/modules/risk/application/services/dynamic-risk-reducer.service';
import { PositionSizingService } from '../../../src/modules/risk/application/services/position-sizing.service';
import { RiskDecision } from '../../../src/modules/risk/domain/enums/risk-decision.enum';
import { RiskViolation } from '../../../src/modules/risk/domain/enums/risk-violation.enum';
import { SignalDirection } from '../../../src/modules/strategy/domain/enums/signal-direction.enum';
import { Signal } from '../../../src/modules/strategy/interfaces/signal.interface';
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

function makeLogger(): any {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

function makeEventBus(): any {
  return {
    publish: jest
      .fn()
      .mockResolvedValue({ _tag: 'ok', value: undefined, isOk: () => true, isErr: () => false }),
    subscribe: jest.fn(),
  };
}

function buildEngine(cfgOverrides: Partial<RiskConfig> = {}): {
  engine: RiskEngineService;
  state: RiskStateService;
  eventBus: any;
} {
  const cfg = makeRiskConfig(cfgOverrides);
  const configService = makeConfigService(cfg);
  const state = new RiskStateService();
  const emergency = new EmergencyProtectionService(state);
  const validator = new TradeValidatorService(configService);
  const portfolioLimits = new PortfolioLimitsService(configService);
  const dailyLimits = new DailyLimitsService(configService, state);
  const dynamicReducer = new DynamicRiskReducerService(configService, state);
  const positionSizing = new PositionSizingService(configService, state);
  const eventBus = makeEventBus();

  const alertEngine: any = { raise: jest.fn().mockResolvedValue({}) };

  const engine = new RiskEngineService(
    configService,
    makeLogger(),
    eventBus,
    state,
    emergency,
    validator,
    portfolioLimits,
    dailyLimits,
    dynamicReducer,
    positionSizing,
    alertEngine,
  );

  engine.onModuleInit();
  return { engine, state, eventBus };
}

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    signalId: 'sig-1',
    timestamp: Date.now(),
    strategyId: 'strat-1',
    exchange: 'binance',
    symbol: 'BTC/USDT',
    direction: SignalDirection.BUY,
    confidence: 0.8,
    reason: 'test',
    metadata: {},
    ...overrides,
  };
}

describe('RiskEngineService', () => {
  describe('APPROVE path', () => {
    it('approves a valid signal', async () => {
      const { engine, state } = buildEngine();
      state.initEquity(100_000);
      const result = await engine.evaluate(makeSignal());
      expect(result.decision).toBe(RiskDecision.APPROVE);
      expect(result.violations).toHaveLength(0);
      expect(result.recommendedSizeUsd).toBeGreaterThan(0);
    });

    it('publishes a RiskDecisionEvent for each approved signal', async () => {
      const { engine, state, eventBus } = buildEngine();
      state.initEquity(100_000);
      await engine.evaluate(makeSignal());
      expect(eventBus.publish).toHaveBeenCalledTimes(1);
    });

    it('approves HOLD without size calculation', async () => {
      const { engine } = buildEngine();
      const result = await engine.evaluate(makeSignal({ direction: SignalDirection.HOLD }));
      expect(result.decision).toBe(RiskDecision.APPROVE);
      expect(result.recommendedSizeUsd).toBeNull();
    });
  });

  describe('BLOCK path — emergency protection', () => {
    it('blocks when kill switch is active', async () => {
      const { engine, state } = buildEngine();
      state.initEquity(100_000);
      engine.triggerKillSwitch();
      const result = await engine.evaluate(makeSignal());
      expect(result.decision).toBe(RiskDecision.BLOCK);
      expect(result.violations).toContain(RiskViolation.KILL_SWITCH_ACTIVE);
    });

    it('blocks when trading is paused', async () => {
      const { engine, state } = buildEngine();
      state.initEquity(100_000);
      engine.pauseTrading();
      const result = await engine.evaluate(makeSignal());
      expect(result.decision).toBe(RiskDecision.BLOCK);
      expect(result.violations).toContain(RiskViolation.TRADING_PAUSED);
    });

    it('blocks BUY when exposure is locked', async () => {
      const { engine, state } = buildEngine();
      state.initEquity(100_000);
      engine.lockExposure();
      const result = await engine.evaluate(makeSignal({ direction: SignalDirection.BUY }));
      expect(result.decision).toBe(RiskDecision.BLOCK);
    });

    it('resumes after pause', async () => {
      const { engine, state } = buildEngine();
      state.initEquity(100_000);
      engine.pauseTrading();
      engine.resume();
      const result = await engine.evaluate(makeSignal());
      expect(result.decision).toBe(RiskDecision.APPROVE);
    });
  });

  describe('REJECT path — trade validation', () => {
    it('rejects blocked symbol', async () => {
      const { engine, state } = buildEngine({ blockedSymbols: ['BTC/USDT'] });
      state.initEquity(100_000);
      const result = await engine.evaluate(makeSignal({ symbol: 'BTC/USDT' }));
      expect(result.decision).toBe(RiskDecision.REJECT);
      expect(result.violations).toContain(RiskViolation.BLOCKED_SYMBOL);
    });

    it('rejects low confidence signal', async () => {
      const { engine, state } = buildEngine({ minConfidenceThreshold: 0.7 });
      state.initEquity(100_000);
      const result = await engine.evaluate(makeSignal({ confidence: 0.3 }));
      expect(result.decision).toBe(RiskDecision.REJECT);
      expect(result.violations).toContain(RiskViolation.CONFIDENCE_TOO_LOW);
    });
  });

  describe('REJECT path — portfolio limits', () => {
    it('rejects when max open positions reached', async () => {
      const { engine } = buildEngine({ maxOpenOrders: 0 });
      const result = await engine.evaluate(makeSignal());
      expect(result.decision).toBe(RiskDecision.REJECT);
      expect(result.violations).toContain(RiskViolation.MAX_OPEN_POSITIONS_EXCEEDED);
    });
  });

  describe('REJECT path — daily limits', () => {
    it('rejects when daily loss limit reached', async () => {
      const { engine, state } = buildEngine({ maxDailyLossUsd: 1_000 });
      state.initEquity(100_000);
      state.recordTrade(-1_000);
      const result = await engine.evaluate(makeSignal());
      expect(result.decision).toBe(RiskDecision.REJECT);
      expect(result.violations).toContain(RiskViolation.MAX_DAILY_LOSS_EXCEEDED);
    });

    it('rejects during losing streak at limit — losing streak scenario', async () => {
      const { engine, state } = buildEngine({ maxConsecutiveLosses: 5 });
      state.initEquity(100_000);
      for (let i = 0; i < 5; i++) state.recordTrade(-200);
      const result = await engine.evaluate(makeSignal());
      expect(result.decision).toBe(RiskDecision.REJECT);
      expect(result.violations).toContain(RiskViolation.MAX_CONSECUTIVE_LOSSES_EXCEEDED);
    });

    it('rejects when flash crash causes drawdown to exceed limit', async () => {
      // maxDailyLossUsd must be high enough so daily loss check passes and drawdown check fires
      const { engine, state } = buildEngine({ maxDrawdownPercent: 10, maxDailyLossUsd: 1_000_000 });
      state.initEquity(100_000);
      state.recordTrade(-15_000);
      const result = await engine.evaluate(makeSignal());
      expect(result.decision).toBe(RiskDecision.REJECT);
      expect(result.violations).toContain(RiskViolation.MAX_DRAWDOWN_EXCEEDED);
    });
  });

  describe('REDUCE path — dynamic reduction', () => {
    it('reduces size after consecutive losses', async () => {
      const { engine, state } = buildEngine({
        maxConsecutiveLosses: 10,
        consecutiveLossReductionThreshold: 3,
        consecutiveLossReductionFactor: 0.5,
      });
      state.initEquity(100_000);
      for (let i = 0; i < 3; i++) state.recordTrade(-100);
      const result = await engine.evaluate(makeSignal());
      expect(result.decision).toBe(RiskDecision.REDUCE);
      expect(result.sizeReductionFactor).toBeCloseTo(0.5);
      expect(result.violations).toContain(RiskViolation.CONSECUTIVE_LOSS_REDUCTION_APPLIED);
    });

    it('reduces size during high volatility', async () => {
      const { engine, state } = buildEngine({
        volatilityReductionThresholdPercent: 30,
        volatilityReductionFactor: 0.5,
      });
      state.initEquity(100_000);
      const result = await engine.evaluate(makeSignal({ metadata: { volatility: 40 } }));
      expect(result.decision).toBe(RiskDecision.REDUCE);
      expect(result.violations).toContain(RiskViolation.VOLATILITY_REDUCTION_APPLIED);
    });

    it('winning streak results in full approval (no reduction)', async () => {
      const { engine, state } = buildEngine();
      state.initEquity(100_000);
      for (let i = 0; i < 5; i++) state.recordTrade(500);
      const result = await engine.evaluate(makeSignal());
      expect(result.decision).toBe(RiskDecision.APPROVE);
      expect(result.sizeReductionFactor).toBe(1.0);
    });
  });

  describe('metrics', () => {
    it('getMetrics() returns current risk state', () => {
      const { engine, state } = buildEngine();
      state.initEquity(100_000);
      state.recordTrade(-1_000);
      const metrics = engine.getMetrics();
      expect(metrics.dailyLoss).toBeCloseTo(1_000);
      expect(metrics.currentEquity).toBeCloseTo(99_000);
    });
  });

  describe('disabled mode', () => {
    it('approves all signals without checks when disabled', async () => {
      const { engine } = buildEngine({ enabled: false });
      const result = await engine.evaluate(makeSignal({ confidence: 0, symbol: 'BLOCKED' }));
      expect(result.decision).toBe(RiskDecision.APPROVE);
    });
  });
});
