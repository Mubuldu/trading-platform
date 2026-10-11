import {
  PositionSizingService,
  SizingInput,
} from '../../../src/modules/risk/application/services/position-sizing.service';
import { RiskStateService } from '../../../src/modules/risk/application/services/risk-state.service';
import { SizingMethod } from '../../../src/modules/risk/domain/enums/sizing-method.enum';
import { RiskConfig } from '../../../src/config/risk.config';

function makeRiskConfig(overrides: Partial<RiskConfig> = {}): RiskConfig {
  return {
    enabled: true,
    defaultEquityUsd: 100_000,
    sizingMethod: 'FIXED_FRACTIONAL',
    riskPerTradePercent: 1,
    maxPositionSizeUsd: 50_000,
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

function makeService(
  cfgOverrides: Partial<RiskConfig> = {},
  state?: RiskStateService,
): PositionSizingService {
  const s = state ?? new RiskStateService();
  return new PositionSizingService(makeConfigService(makeRiskConfig(cfgOverrides)), s);
}

function makeInput(overrides: Partial<SizingInput> = {}): SizingInput {
  return {
    equity: 100_000,
    availableBalance: 100_000,
    ...overrides,
  };
}

describe('PositionSizingService', () => {
  describe('Fixed Fractional', () => {
    it('sizes at riskPercent of equity', () => {
      const svc = makeService({ sizingMethod: 'FIXED_FRACTIONAL', riskPerTradePercent: 1 });
      const result = svc.calculate(makeInput({ equity: 100_000 }));
      expect(result.method).toBe(SizingMethod.FIXED_FRACTIONAL);
      expect(result.sizeUsd).toBe(1_000);
    });

    it('respects maxOrderSizeUsd cap', () => {
      const svc = makeService({
        sizingMethod: 'FIXED_FRACTIONAL',
        riskPerTradePercent: 50,
        maxOrderSizeUsd: 5_000,
      });
      const result = svc.calculate(makeInput({ equity: 100_000 }));
      expect(result.sizeUsd).toBe(5_000);
    });

    it('respects maxPositionSizeUsd cap', () => {
      const svc = makeService({
        sizingMethod: 'FIXED_FRACTIONAL',
        riskPerTradePercent: 10,
        maxPositionSizeUsd: 2_000,
      });
      const result = svc.calculate(makeInput({ equity: 100_000 }));
      expect(result.sizeUsd).toBe(2_000);
    });

    it('respects availableBalance cap', () => {
      const svc = makeService({ sizingMethod: 'FIXED_FRACTIONAL', riskPerTradePercent: 10 });
      const result = svc.calculate(makeInput({ equity: 100_000, availableBalance: 500 }));
      expect(result.sizeUsd).toBe(500);
    });
  });

  describe('ATR sizing', () => {
    it('calculates ATR-based size correctly', () => {
      const svc = makeService({ sizingMethod: 'ATR', riskPerTradePercent: 1, atrMultiplier: 2 });
      const result = svc.calculate(
        makeInput({ equity: 100_000, currentAtr: 0.05, currentPrice: 40_000 }),
      );
      expect(result.method).toBe(SizingMethod.ATR);
      expect(result.sizeUsd).toBeGreaterThan(0);
    });

    it('falls back to fixed fractional when ATR is missing', () => {
      const svc = makeService({ sizingMethod: 'ATR', riskPerTradePercent: 1 });
      const result = svc.calculate(makeInput({ equity: 100_000 }));
      expect(result.method).toBe(SizingMethod.FIXED_FRACTIONAL);
      expect(result.sizeUsd).toBe(1_000);
    });
  });

  describe('Fractional Kelly', () => {
    it('falls back to fixed fractional when no trade history', () => {
      const svc = makeService({ sizingMethod: 'FRACTIONAL_KELLY' });
      const result = svc.calculate(makeInput());
      expect(result.method).toBe(SizingMethod.FRACTIONAL_KELLY);
      expect(result.sizeUsd).toBe(1_000);
    });

    it('sizes based on kelly fraction with winning history', () => {
      const state = new RiskStateService();
      state.initEquity(100_000);
      for (let i = 0; i < 7; i++) state.recordTrade(300);
      for (let i = 0; i < 3; i++) state.recordTrade(-100);
      const svc = makeService(
        { sizingMethod: 'FRACTIONAL_KELLY', kellyFractionMultiplier: 0.25 },
        state,
      );
      const result = svc.calculate(makeInput({ equity: 100_000, availableBalance: 100_000 }));
      expect(result.sizeUsd).toBeGreaterThan(0);
    });
  });

  describe('Volatility Targeting', () => {
    it('falls back to fixed fractional when volatility is missing', () => {
      const svc = makeService({ sizingMethod: 'VOLATILITY_TARGETING' });
      const result = svc.calculate(makeInput());
      expect(result.method).toBe(SizingMethod.FIXED_FRACTIONAL);
    });

    it('reduces size when volatility is above target', () => {
      const svc = makeService({
        sizingMethod: 'VOLATILITY_TARGETING',
        targetVolatilityPercent: 15,
        riskPerTradePercent: 1,
      });
      const high = svc.calculate(
        makeInput({ currentVolatility: 30, equity: 100_000, availableBalance: 100_000 }),
      );
      const low = svc.calculate(
        makeInput({ currentVolatility: 10, equity: 100_000, availableBalance: 100_000 }),
      );
      expect(high.sizeUsd).toBeLessThan(low.sizeUsd);
    });
  });

  describe('Safety', () => {
    it('never returns negative size', () => {
      const svc = makeService({ riskPerTradePercent: 0.001 });
      const result = svc.calculate(makeInput({ equity: 1, availableBalance: 0 }));
      expect(result.sizeUsd).toBeGreaterThanOrEqual(0);
    });
  });
});
