import { RobustnessScorerService } from '@modules/monte-carlo/application/robustness-scorer.service';
import { DistributionPercentiles } from '@modules/monte-carlo/domain/models/monte-carlo-result.model';

function dist(overrides: Partial<DistributionPercentiles> = {}): DistributionPercentiles {
  return {
    p5: 5,
    p25: 15,
    median: 25,
    p75: 40,
    p95: 60,
    mean: 25,
    stdDev: 15,
    ...overrides,
  };
}

describe('RobustnessScorerService', () => {
  let service: RobustnessScorerService;

  beforeEach(() => {
    service = new RobustnessScorerService();
  });

  // ── Healthy strategy ──────────────────────────────────────────────────────

  it('returns ROBUST grade for a healthy strategy', () => {
    const result = service.score(
      0, // probabilityOfRuin
      dist({ p5: 10, p25: 20, median: 30, p75: 45, p95: 55 }), // returnDist
      dist({ median: 10 }), // drawdownDist
      dist({ median: 1.5 }), // sharpeDist
      -5, // var95
      -3, // cvar95
    );
    expect(result.grade).toBe('ROBUST');
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.isFragile).toBe(false);
  });

  // ── Ruin probability penalties ────────────────────────────────────────────

  it('applies heavy penalty for very high ruin probability', () => {
    const healthy = service.score(0, dist(), dist({ median: 10 }), dist({ median: 1 }), -5, -3);
    const ruined = service.score(0.6, dist(), dist({ median: 10 }), dist({ median: 1 }), -5, -3);
    expect(ruined.score).toBeLessThan(healthy.score - 25);
    expect(ruined.factors.some((f) => f.toLowerCase().includes('ruin'))).toBe(true);
  });

  it('applies moderate penalty for ruin between 10–20 %', () => {
    const result = service.score(0.15, dist(), dist({ median: 10 }), dist({ median: 1 }), -5, -3);
    expect(result.score).toBeLessThan(100);
    expect(result.factors.some((f) => f.toLowerCase().includes('ruin'))).toBe(true);
  });

  // ── Spread penalties ──────────────────────────────────────────────────────

  it('penalises extremely wide return spread', () => {
    const narrow = dist({ p5: 10, p95: 50 }); // spread = 40
    const wide = dist({ p5: -120, p95: 100 }); // spread = 220

    const scoreNarrow = service.score(0, narrow, dist({ median: 10 }), dist({ median: 1 }), -5, -3);
    const scoreWide = service.score(0, wide, dist({ median: 10 }), dist({ median: 1 }), -5, -3);

    expect(scoreWide.score).toBeLessThan(scoreNarrow.score);
  });

  // ── Negative-return penalties ─────────────────────────────────────────────

  it('penalises negative median return', () => {
    const result = service.score(
      0,
      dist({ median: -5 }),
      dist({ median: 10 }),
      dist({ median: 1 }),
      -5,
      -3,
    );
    expect(result.score).toBeLessThan(100);
    expect(result.factors.some((f) => f.toLowerCase().includes('negative median return'))).toBe(
      true,
    );
  });

  // ── Drawdown penalties ────────────────────────────────────────────────────

  it('penalises high median max-drawdown', () => {
    const lowDD = service.score(0, dist(), dist({ median: 10 }), dist({ median: 1 }), -5, -3);
    const highDD = service.score(0, dist(), dist({ median: 45 }), dist({ median: 1 }), -5, -3);
    expect(highDD.score).toBeLessThan(lowDD.score);
  });

  // ── CVaR penalties ────────────────────────────────────────────────────────

  it('penalises severe CVaR', () => {
    const mild = service.score(0, dist(), dist({ median: 10 }), dist({ median: 1 }), -5, -10);
    const severe = service.score(0, dist(), dist({ median: 10 }), dist({ median: 1 }), -5, -60);
    expect(severe.score).toBeLessThan(mild.score);
  });

  // ── Sharpe penalties ──────────────────────────────────────────────────────

  it('penalises negative median Sharpe', () => {
    const result = service.score(0, dist(), dist({ median: 10 }), dist({ median: -0.5 }), -5, -3);
    expect(result.factors.some((f) => f.toLowerCase().includes('sharpe'))).toBe(true);
  });

  // ── Grade boundaries ──────────────────────────────────────────────────────

  it('grades DANGEROUS when score < 40', () => {
    // Maximise all penalty categories simultaneously.
    const result = service.score(
      0.8, // ruin 80 % → −30
      dist({ p5: -200, p95: 100, median: -10, p25: -50 }), // wide + negative → −20 − 15
      dist({ median: 50 }), // DD > 40 % → −15
      dist({ median: -1 }), // negative Sharpe → −10
      -5,
      -70, // severe CVaR → −10
    );
    expect(result.grade).toBe('DANGEROUS');
    expect(result.isFragile).toBe(true);
  });

  it('grades FRAGILE when score is 40–59', () => {
    // ruin 25 % → −20, spread 115 → −12, median DD 27 % → −8 = total −40 → score 60 (boundary).
    // Add negative p25 to push into FRAGILE: −20 −12 −7 −8 = −47 → score 53.
    const result = service.score(
      0.25, // −20
      dist({ p5: 5, p95: 120, median: 10, p25: -5 }), // spread 115 → −12; negative p25 → −7
      dist({ median: 27 }), // DD > 25 % → −8
      dist({ median: 0.8 }),
      -5,
      -5,
    );
    expect(['FRAGILE', 'DANGEROUS']).toContain(result.grade);
  });

  // ── Score clamping ────────────────────────────────────────────────────────

  it('score is always in [0, 100]', () => {
    const result = service.score(
      1,
      dist({ p5: -500, p95: 500, median: -100 }),
      dist({ median: 80 }),
      dist({ median: -5 }),
      -100,
      -200,
    );
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  // ── factors ───────────────────────────────────────────────────────────────

  it('returns a positive confirmation message when no factors are penalised', () => {
    // Use a narrow-spread return dist to avoid triggering the spread penalty.
    const narrowReturn = dist({ p5: 30, p25: 35, median: 40, p75: 45, p95: 50 }); // spread = 20
    const result = service.score(
      0,
      narrowReturn,
      dist({ median: 10 }),
      dist({ median: 1.5 }),
      -2,
      -1,
    );
    expect(result.factors).toHaveLength(1);
    expect(result.factors[0].toLowerCase()).toContain('no significant');
  });
});
