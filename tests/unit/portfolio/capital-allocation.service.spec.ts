import { CapitalAllocationService } from '../../../src/modules/portfolio/application/services/capital-allocation.service';
import { AllocationMethod } from '../../../src/modules/portfolio/domain/enums/allocation-method.enum';

describe('CapitalAllocationService', () => {
  let svc: CapitalAllocationService;

  beforeEach(() => {
    svc = new CapitalAllocationService();
  });

  const strategies = ['strat-a', 'strat-b', 'strat-c'];
  const capital = 300_000;

  // ── Edge cases ────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns empty allocations for no strategies', () => {
      const result = svc.compute(AllocationMethod.EQUAL_WEIGHT, [], capital);
      expect(result.allocations).toHaveLength(0);
    });

    it('sets method and totalCapital correctly', () => {
      const result = svc.compute(AllocationMethod.EQUAL_WEIGHT, strategies, capital);
      expect(result.method).toBe(AllocationMethod.EQUAL_WEIGHT);
      expect(result.totalCapital).toBe(capital);
    });

    it('weights always sum to 1 (within floating-point tolerance)', () => {
      const result = svc.compute(AllocationMethod.EQUAL_WEIGHT, strategies, capital);
      const sum = result.allocations.reduce((s, a) => s + a.weight, 0);
      expect(sum).toBeCloseTo(1, 10);
    });
  });

  // ── Equal weight ──────────────────────────────────────────────────────────

  describe('EQUAL_WEIGHT', () => {
    it('assigns equal weight to all strategies', () => {
      const result = svc.compute(AllocationMethod.EQUAL_WEIGHT, strategies, capital);
      for (const alloc of result.allocations) {
        expect(alloc.weight).toBeCloseTo(1 / 3, 10);
      }
    });

    it('allocates equal capital to all strategies', () => {
      const result = svc.compute(AllocationMethod.EQUAL_WEIGHT, strategies, capital);
      for (const alloc of result.allocations) {
        expect(alloc.allocatedCapital).toBeCloseTo(100_000, 5);
      }
    });

    it('handles single strategy (100% weight)', () => {
      const result = svc.compute(AllocationMethod.EQUAL_WEIGHT, ['only'], capital);
      expect(result.allocations[0].weight).toBe(1);
      expect(result.allocations[0].allocatedCapital).toBe(capital);
    });
  });

  // ── Risk weight ───────────────────────────────────────────────────────────

  describe('RISK_WEIGHT', () => {
    it('falls back to equal weight when no risk values provided', () => {
      const result = svc.compute(AllocationMethod.RISK_WEIGHT, strategies, capital);
      for (const alloc of result.allocations) {
        expect(alloc.weight).toBeCloseTo(1 / 3, 10);
      }
    });

    it('assigns higher weight to lower-risk strategies', () => {
      const risks = new Map([
        ['strat-a', 0.5],
        ['strat-b', 1.0],
        ['strat-c', 2.0],
      ]);
      const result = svc.compute(AllocationMethod.RISK_WEIGHT, strategies, capital, {
        riskValues: risks,
      });
      const wa = result.allocations.find((a) => a.strategyId === 'strat-a')!.weight;
      const wc = result.allocations.find((a) => a.strategyId === 'strat-c')!.weight;
      expect(wa).toBeGreaterThan(wc);
    });

    it('weights sum to 1', () => {
      const risks = new Map([
        ['strat-a', 0.1],
        ['strat-b', 0.3],
        ['strat-c', 0.6],
      ]);
      const result = svc.compute(AllocationMethod.RISK_WEIGHT, strategies, capital, {
        riskValues: risks,
      });
      const sum = result.allocations.reduce((s, a) => s + a.weight, 0);
      expect(sum).toBeCloseTo(1, 10);
    });
  });

  // ── Volatility weight ─────────────────────────────────────────────────────

  describe('VOLATILITY_WEIGHT', () => {
    it('assigns higher weight to lower-volatility strategies', () => {
      const vols = new Map([
        ['strat-a', 0.1],
        ['strat-b', 0.3],
        ['strat-c', 0.6],
      ]);
      const result = svc.compute(AllocationMethod.VOLATILITY_WEIGHT, strategies, capital, {
        volatilityValues: vols,
      });
      const wa = result.allocations.find((a) => a.strategyId === 'strat-a')!.weight;
      const wc = result.allocations.find((a) => a.strategyId === 'strat-c')!.weight;
      expect(wa).toBeGreaterThan(wc);
    });

    it('weights sum to 1', () => {
      const vols = new Map([
        ['strat-a', 0.1],
        ['strat-b', 0.2],
        ['strat-c', 0.3],
      ]);
      const result = svc.compute(AllocationMethod.VOLATILITY_WEIGHT, strategies, capital, {
        volatilityValues: vols,
      });
      const sum = result.allocations.reduce((s, a) => s + a.weight, 0);
      expect(sum).toBeCloseTo(1, 10);
    });
  });

  // ── Kelly weight ──────────────────────────────────────────────────────────

  describe('KELLY_WEIGHT', () => {
    it('proportional to Kelly fractions', () => {
      const kelly = new Map([
        ['strat-a', 0.4],
        ['strat-b', 0.2],
        ['strat-c', 0.4],
      ]);
      const result = svc.compute(AllocationMethod.KELLY_WEIGHT, strategies, capital, {
        kellyValues: kelly,
      });
      const wa = result.allocations.find((a) => a.strategyId === 'strat-a')!.weight;
      const wb = result.allocations.find((a) => a.strategyId === 'strat-b')!.weight;
      expect(wa).toBeGreaterThan(wb);
      expect(wa).toBeCloseTo(0.4, 5);
    });

    it('clamps negative Kelly to zero and distributes remaining', () => {
      const kelly = new Map([
        ['strat-a', -0.1],
        ['strat-b', 0.5],
        ['strat-c', 0.5],
      ]);
      const result = svc.compute(
        AllocationMethod.KELLY_WEIGHT,
        ['strat-a', 'strat-b', 'strat-c'],
        capital,
        {
          kellyValues: kelly,
        },
      );
      const wa = result.allocations.find((a) => a.strategyId === 'strat-a')!.weight;
      expect(wa).toBe(0);
      const sum = result.allocations.reduce((s, a) => s + a.weight, 0);
      expect(sum).toBeCloseTo(1, 10);
    });

    it('falls back to equal weight when all Kelly are zero', () => {
      const kelly = new Map([
        ['strat-a', 0],
        ['strat-b', 0],
        ['strat-c', 0],
      ]);
      const result = svc.compute(AllocationMethod.KELLY_WEIGHT, strategies, capital, {
        kellyValues: kelly,
      });
      for (const alloc of result.allocations) {
        expect(alloc.weight).toBeCloseTo(1 / 3, 10);
      }
    });
  });

  // ── Custom weight ─────────────────────────────────────────────────────────

  describe('CUSTOM', () => {
    it('uses provided custom weights normalised to 1', () => {
      const custom = new Map([
        ['strat-a', 50],
        ['strat-b', 30],
        ['strat-c', 20],
      ]);
      const result = svc.compute(AllocationMethod.CUSTOM, strategies, capital, {
        customWeights: custom,
      });
      const wa = result.allocations.find((a) => a.strategyId === 'strat-a')!.weight;
      const wb = result.allocations.find((a) => a.strategyId === 'strat-b')!.weight;
      const wc = result.allocations.find((a) => a.strategyId === 'strat-c')!.weight;
      expect(wa).toBeCloseTo(0.5, 5);
      expect(wb).toBeCloseTo(0.3, 5);
      expect(wc).toBeCloseTo(0.2, 5);
    });

    it('falls back to equal weight when no custom weights provided', () => {
      const result = svc.compute(AllocationMethod.CUSTOM, strategies, capital);
      for (const alloc of result.allocations) {
        expect(alloc.weight).toBeCloseTo(1 / 3, 10);
      }
    });
  });

  // ── maxPositionSize ───────────────────────────────────────────────────────

  describe('maxPositionSize', () => {
    it('respects maxPositionSizePercent option', () => {
      const result = svc.compute(AllocationMethod.EQUAL_WEIGHT, ['strat-a'], 100_000, {
        maxPositionSizePercent: 0.1,
      });
      expect(result.allocations[0].maxPositionSize).toBeCloseTo(10_000, 5);
    });

    it('defaults maxPositionSize to 20% of allocated capital', () => {
      const result = svc.compute(AllocationMethod.EQUAL_WEIGHT, ['strat-a'], 100_000, {
        maxPositionSizePercent: 0.2,
      });
      expect(result.allocations[0].maxPositionSize).toBeCloseTo(20_000, 5);
    });
  });
});
