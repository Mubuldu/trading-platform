import { Injectable } from '@nestjs/common';
import { Heatmap, HeatmapCell, HeatmapMetric, HeatmapSet } from '../domain/models/heatmap.model';
import { SweepResultEntry, SweepMetrics } from '../domain/models/sweep-result.model';
import { mean } from './stat-utils';

/**
 * HeatmapGeneratorService
 *
 * Produces four 2-D heatmaps (Profit, Sharpe, Drawdown, Win Rate) for every
 * unique pair of parameters in a completed parameter sweep.
 *
 * Algorithm:
 *   For a pair (param1, param2):
 *     – Identify all unique (p1_val, p2_val) combinations.
 *     – Average the target metric across all sweep results sharing that pair,
 *       regardless of the other parameters ("marginal 2-D view").
 *     – Produce one HeatmapCell per unique pair.
 *
 * Heatmaps with fewer than 4 total cells (e.g. a 1×2 or 2×1 grid) are still
 * valid output but give little visual information.
 */
@Injectable()
export class HeatmapGeneratorService {
  /**
   * Generates all HeatmapSets for the given sweep results.
   * Returns one set per unique unordered parameter pair.
   * Returns an empty array when the parameter space has fewer than 2 dimensions.
   */
  generateAll(results: SweepResultEntry[]): HeatmapSet[] {
    if (results.length === 0) return [];
    const paramNames = Object.keys(results[0].params);
    if (paramNames.length < 2) return [];

    const sets: HeatmapSet[] = [];
    for (let i = 0; i < paramNames.length; i++) {
      for (let j = i + 1; j < paramNames.length; j++) {
        sets.push(this.generateSet(paramNames[i], paramNames[j], results));
      }
    }
    return sets;
  }

  /**
   * Generates one HeatmapSet for a specific (param1, param2) pair.
   */
  generateSet(param1Name: string, param2Name: string, results: SweepResultEntry[]): HeatmapSet {
    return {
      param1Name,
      param2Name,
      profit: this.buildHeatmap(param1Name, param2Name, 'PROFIT', results),
      sharpe: this.buildHeatmap(param1Name, param2Name, 'SHARPE', results),
      drawdown: this.buildHeatmap(param1Name, param2Name, 'DRAWDOWN', results),
      winRate: this.buildHeatmap(param1Name, param2Name, 'WIN_RATE', results),
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private buildHeatmap(
    param1Name: string,
    param2Name: string,
    metric: HeatmapMetric,
    results: SweepResultEntry[],
  ): Heatmap {
    // Collect values grouped by (p1_val, p2_val)
    const groups = new Map<string, number[]>();
    const p1Set = new Set<number>();
    const p2Set = new Set<number>();

    for (const r of results) {
      const p1Val = r.params[param1Name];
      const p2Val = r.params[param2Name];
      if (p1Val === undefined || p2Val === undefined) continue;

      p1Set.add(p1Val);
      p2Set.add(p2Val);

      const key = `${p1Val}|${p2Val}`;
      const bucket = groups.get(key) ?? [];
      bucket.push(this.extractMetric(metric, r.metrics));
      groups.set(key, bucket);
    }

    const param1Values = Array.from(p1Set).sort((a, b) => a - b);
    const param2Values = Array.from(p2Set).sort((a, b) => a - b);

    const cells: HeatmapCell[] = [];
    for (const p1Val of param1Values) {
      for (const p2Val of param2Values) {
        const key = `${p1Val}|${p2Val}`;
        const bucket = groups.get(key) ?? [];
        if (bucket.length === 0) continue;
        cells.push({
          param1Value: p1Val,
          param2Value: p2Val,
          value: mean(bucket),
          count: bucket.length,
        });
      }
    }

    const values = cells.map((c) => c.value);
    const minVal = values.length > 0 ? Math.min(...values) : 0;
    const maxVal = values.length > 0 ? Math.max(...values) : 0;
    const meanVal = values.length > 0 ? mean(values) : 0;

    return {
      param1Name,
      param2Name,
      metric,
      cells,
      min: minVal,
      max: maxVal,
      mean: meanVal,
      param1Values,
      param2Values,
    };
  }

  private extractMetric(metric: HeatmapMetric, m: SweepMetrics): number {
    switch (metric) {
      case 'PROFIT':
        return m.netProfitPercent;
      case 'SHARPE':
        return m.sharpe;
      case 'DRAWDOWN':
        return m.maxDrawdownPercent;
      case 'WIN_RATE':
        return m.winRate;
    }
  }
}
