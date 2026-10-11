import { DeflatedSharpeService } from '@modules/parameter-stability/application/deflated-sharpe.service';
import { ProbabilisticSharpeService } from '@modules/parameter-stability/application/probabilistic-sharpe.service';

function normalReturns(n: number, mu: number, sigma: number, seed = 1): number[] {
  let s = seed;
  const lcg = () => {
    s = Math.imul(s, 1664525) + 1013904223;
    return (s >>> 0) / 0x100000000;
  };
  const out: number[] = [];
  while (out.length < n) {
    const u1 = Math.max(lcg(), 1e-15);
    const u2 = lcg();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const z1 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
    out.push(mu + sigma * z0);
    if (out.length < n) out.push(mu + sigma * z1);
  }
  return out.slice(0, n);
}

describe('DeflatedSharpeService', () => {
  let psrService: ProbabilisticSharpeService;
  let service: DeflatedSharpeService;

  beforeEach(() => {
    psrService = new ProbabilisticSharpeService();
    service = new DeflatedSharpeService(psrService);
  });

  it('nTrials and nObservations are recorded correctly', () => {
    const returns = normalReturns(200, 0.001, 0.01, 5);
    const sharpes = [0.5, 0.8, 1.2, 0.3, 0.9];
    const result = service.compute(returns, sharpes);
    expect(result.nTrials).toBe(5);
    expect(result.nObservations).toBe(200);
  });

  it('DSR ≤ PSR for the same returns (adjusting for multiple trials)', () => {
    const returns = normalReturns(300, 0.001, 0.01, 17);
    // With N=50 trials the DSR benchmark is harder to clear than PSR(SR*=0)
    const sharpes = Array.from({ length: 50 }, (_, i) => 0.2 + i * 0.02);
    const result = service.compute(returns, sharpes);
    const psrResult = psrService.compute(returns, 0);
    // DSR ≤ PSR because the DSR benchmark (minRequiredSharpe) ≥ 0
    expect(result.deflatedSharpeRatio).toBeLessThanOrEqual(psrResult.psr + 1e-9);
  });

  it('minRequiredSharpe increases as nTrials increases', () => {
    const returns = normalReturns(200, 0.001, 0.01, 3);
    const fewShares = [0.5, 1.0, 0.7]; // N=3
    const manyShares = Array.from({ length: 100 }, (_, i) => 0.5 + i * 0.01); // N=100, spread gives σ > 0
    const few = service.compute(returns, fewShares);
    const many = service.compute(returns, manyShares);
    // More trials → higher Φ⁻¹(1−1/N) → higher SR_min (assuming comparable σ_SR)
    expect(many.minRequiredSharpe).toBeGreaterThanOrEqual(few.minRequiredSharpe);
  });

  it('returns isSignificant=true for a clearly significant strategy with few trials', () => {
    // High Sharpe, lots of observations, only 2 trials
    const returns = normalReturns(1000, 0.003, 0.005, 55);
    const sharpes = [0.1, 4.0]; // best is very high
    const result = service.compute(returns, sharpes);
    expect(result.isSignificant).toBe(true);
  });

  it('returns isSignificant=false for a marginal Sharpe with many trials', () => {
    // Low Sharpe but 500 trials → DSR should fail
    const returns = normalReturns(50, 0.0001, 0.01, 99);
    const sharpes = Array.from({ length: 500 }, (_, i) => -1 + i * 0.004);
    const result = service.compute(returns, sharpes);
    expect(result.isSignificant).toBe(false);
  });

  it('trialSharpeStdDev matches sample std (ddof=1) of sweepSharpes', () => {
    const returns = normalReturns(100, 0.001, 0.01, 1);
    const sharpes = [0.0, 1.0, 2.0]; // mean=1
    const result = service.compute(returns, sharpes);
    // Sample std (ddof=1) of [0,1,2]: variance = ((0-1)²+(1-1)²+(2-1)²)/2 = 1, std = 1
    expect(result.trialSharpeStdDev).toBeCloseTo(1.0, 2);
  });

  it('handles single-trial input gracefully', () => {
    const returns = normalReturns(100, 0.001, 0.01, 2);
    const result = service.compute(returns, [1.5]);
    expect(result.nTrials).toBe(1);
    expect(result.minRequiredSharpe).toBe(0); // N=1 → no correction
  });
});
