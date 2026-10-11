import { GridSearchService } from '@modules/parameter-stability/application/grid-search.service';

describe('GridSearchService', () => {
  let service: GridSearchService;

  beforeEach(() => {
    service = new GridSearchService();
  });

  // ── expand ─────────────────────────────────────────────────────────────────

  it('returns [{}] for an empty grid', () => {
    expect(service.expand({})).toEqual([{}]);
  });

  it('expands a single-parameter grid', () => {
    const result = service.expand({ period: [10, 20, 30] });
    expect(result).toEqual([{ period: 10 }, { period: 20 }, { period: 30 }]);
  });

  it('expands a two-parameter grid into a Cartesian product', () => {
    const result = service.expand({ period: [10, 20], mult: [1.5, 2.0] });
    expect(result).toHaveLength(4);
    // First key (period) varies slowest
    expect(result[0]).toEqual({ period: 10, mult: 1.5 });
    expect(result[1]).toEqual({ period: 10, mult: 2.0 });
    expect(result[2]).toEqual({ period: 20, mult: 1.5 });
    expect(result[3]).toEqual({ period: 20, mult: 2.0 });
  });

  it('expands a three-parameter grid correctly', () => {
    const result = service.expand({ a: [1, 2], b: [3, 4], c: [5, 6] });
    expect(result).toHaveLength(8);
    // Verify first and last entries
    expect(result[0]).toEqual({ a: 1, b: 3, c: 5 });
    expect(result[7]).toEqual({ a: 2, b: 4, c: 6 });
  });

  it('handles a grid where one parameter has only one value', () => {
    const result = service.expand({ period: [20], mult: [1.5, 2.0] });
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ period: 20, mult: 1.5 });
    expect(result[1]).toEqual({ period: 20, mult: 2.0 });
  });

  // ── totalCombinations ──────────────────────────────────────────────────────

  it('returns 1 for an empty grid', () => {
    expect(service.totalCombinations({})).toBe(1);
  });

  it('returns the product of lengths for a multi-param grid', () => {
    expect(service.totalCombinations({ a: [1, 2, 3], b: [4, 5], c: [6, 7, 8, 9] })).toBe(24);
  });

  it('totalCombinations matches expand().length', () => {
    const grid = { period: [5, 10, 15, 20], mult: [1, 2, 3] };
    expect(service.totalCombinations(grid)).toBe(service.expand(grid).length);
  });
});
