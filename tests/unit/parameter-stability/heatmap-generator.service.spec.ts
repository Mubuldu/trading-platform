import { HeatmapGeneratorService } from '@modules/parameter-stability/application/heatmap-generator.service';
import { SweepResultEntry } from '@modules/parameter-stability/domain/models/sweep-result.model';

function entry(
  params: Record<string, number>,
  sharpe: number,
  profit = 100,
  dd = 10,
  wr = 0.6,
): SweepResultEntry {
  return {
    params,
    metrics: {
      sharpe,
      netProfitPercent: profit,
      maxDrawdownPercent: dd,
      winRate: wr,
    },
  };
}

describe('HeatmapGeneratorService', () => {
  let service: HeatmapGeneratorService;

  beforeEach(() => {
    service = new HeatmapGeneratorService();
  });

  it('returns [] for empty results', () => {
    expect(service.generateAll([])).toEqual([]);
  });

  it('returns [] when there is only one parameter', () => {
    const results = [entry({ period: 10 }, 1.0), entry({ period: 20 }, 1.5)];
    expect(service.generateAll(results)).toHaveLength(0);
  });

  it('generates one HeatmapSet for a 2-parameter grid', () => {
    const results = [
      entry({ period: 10, mult: 1 }, 1.0),
      entry({ period: 10, mult: 2 }, 1.5),
      entry({ period: 20, mult: 1 }, 1.2),
      entry({ period: 20, mult: 2 }, 1.8),
    ];
    const sets = service.generateAll(results);
    expect(sets).toHaveLength(1);
    expect(sets[0].param1Name).toBe('period');
    expect(sets[0].param2Name).toBe('mult');
  });

  it('generates C(3,2) = 3 sets for a 3-parameter grid', () => {
    const results = [entry({ a: 1, b: 1, c: 1 }, 1.0), entry({ a: 1, b: 2, c: 2 }, 1.5)];
    const sets = service.generateAll(results);
    expect(sets).toHaveLength(3);
  });

  it('each HeatmapSet contains all four metric heatmaps', () => {
    const results = [entry({ period: 10, mult: 1 }, 1.0), entry({ period: 20, mult: 2 }, 2.0)];
    const set = service.generateAll(results)[0];
    expect(set.profit).toBeDefined();
    expect(set.sharpe).toBeDefined();
    expect(set.drawdown).toBeDefined();
    expect(set.winRate).toBeDefined();
  });

  it('heatmap cells have correct mean values', () => {
    // Two results with period=10, mult=1 — sharpe 1.0 and 2.0 → cell mean = 1.5
    const results = [entry({ period: 10, mult: 1 }, 1.0), entry({ period: 10, mult: 1 }, 2.0)];
    const set = service.generateSet('period', 'mult', results);
    expect(set.sharpe.cells[0].value).toBeCloseTo(1.5);
    expect(set.sharpe.cells[0].count).toBe(2);
  });

  it('heatmap reports correct min/max', () => {
    const results = [
      entry({ period: 10, mult: 1 }, 0.5),
      entry({ period: 10, mult: 2 }, 1.0),
      entry({ period: 20, mult: 1 }, 1.5),
      entry({ period: 20, mult: 2 }, 2.0),
    ];
    const set = service.generateSet('period', 'mult', results);
    expect(set.sharpe.min).toBeCloseTo(0.5);
    expect(set.sharpe.max).toBeCloseTo(2.0);
  });

  it('param1Values and param2Values are sorted ascending', () => {
    const results = [
      entry({ period: 30, mult: 2 }, 1.0),
      entry({ period: 10, mult: 3 }, 1.0),
      entry({ period: 20, mult: 1 }, 1.0),
    ];
    const set = service.generateSet('period', 'mult', results);
    expect(set.sharpe.param1Values).toEqual([10, 20, 30]);
    expect(set.sharpe.param2Values).toEqual([1, 2, 3]);
  });

  it('DRAWDOWN heatmap extracts maxDrawdownPercent', () => {
    const results = [
      entry({ period: 10, mult: 1 }, 1.0, 100, 5, 0.6),
      entry({ period: 20, mult: 2 }, 1.0, 100, 20, 0.6),
    ];
    const set = service.generateSet('period', 'mult', results);
    const dd10 = set.drawdown.cells.find((c) => c.param1Value === 10);
    const dd20 = set.drawdown.cells.find((c) => c.param1Value === 20);
    expect(dd10?.value).toBeCloseTo(5);
    expect(dd20?.value).toBeCloseTo(20);
  });
});
