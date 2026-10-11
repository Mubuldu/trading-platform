import { ProbabilisticSharpeService } from '@modules/parameter-stability/application/probabilistic-sharpe.service';

/** Generate N i.i.d. normal(μ, σ) returns using a simple seed. */
function normalReturns(n: number, mu: number, sigma: number, seed = 1): number[] {
  let s = seed;
  const lcg = () => {
    s = Math.imul(s, 1664525) + 1013904223;
    return (s >>> 0) / 0x100000000;
  };
  // Box-Muller
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

describe('ProbabilisticSharpeService', () => {
  let service: ProbabilisticSharpeService;

  beforeEach(() => {
    service = new ProbabilisticSharpeService();
  });

  it('returns psr=0.5 for trivially short series (<3 observations)', () => {
    const result = service.compute([0.01, -0.01]);
    expect(result.psr).toBeCloseTo(0.5);
    expect(result.isSignificant).toBe(false);
  });

  it('PSR increases with T for a fixed positive Sharpe', () => {
    const mu = 0.001;
    const sigma = 0.01;
    const small = service.compute(normalReturns(50, mu, sigma));
    const large = service.compute(normalReturns(500, mu, sigma));
    expect(large.psr).toBeGreaterThan(small.psr);
  });

  it('PSR close to 1 for a very high observed Sharpe with many observations', () => {
    // mu/sigma = 0.1, T = 1000 → Sharpe ≈ 0.1, should be very significant
    const returns = normalReturns(1000, 0.002, 0.002, 123);
    const result = service.compute(returns, 0);
    expect(result.psr).toBeGreaterThan(0.95);
    expect(result.isSignificant).toBe(true);
  });

  it('PSR ≈ 0.5 when observed Sharpe equals the benchmark', () => {
    // Use constant returns so SR = 0 and benchmark = 0
    const returns = new Array(100).fill(0);
    const result = service.compute(returns, 0);
    // stdDev = 0 → edge case; SR = 0 = benchmark → expect ~0.5
    expect(result.psr).toBeCloseTo(0.5, 0);
  });

  it('PSR < 0.5 when observed Sharpe is below the benchmark', () => {
    // Negative returns → SR < 0 → below benchmark = 0
    const returns = normalReturns(200, -0.002, 0.01, 7);
    const result = service.compute(returns, 0);
    expect(result.psr).toBeLessThan(0.5);
  });

  it('nObservations matches the input length', () => {
    const returns = normalReturns(300, 0.001, 0.01, 99);
    const result = service.compute(returns);
    expect(result.nObservations).toBe(300);
  });

  it('standard error is positive', () => {
    const returns = normalReturns(100, 0.001, 0.01, 42);
    const result = service.compute(returns);
    expect(result.standardError).toBeGreaterThan(0);
  });

  it('skewness and kurtosis are numbers', () => {
    const returns = normalReturns(100, 0.001, 0.01, 11);
    const result = service.compute(returns);
    expect(typeof result.skewness).toBe('number');
    expect(typeof result.excessKurtosis).toBe('number');
  });
});
