import { Injectable } from '@nestjs/common';
import { ParameterRegionType } from '../domain/enums/parameter-region-type.enum';
import { ParameterRegion, ParameterRegionReport } from '../domain/models/parameter-region.model';
import { SweepResultEntry } from '../domain/models/sweep-result.model';
import { mean, stdDev } from './stat-utils';

/**
 * ParameterRegionDetectorService
 *
 * Analyses the 1-D marginal metric surface (Sharpe) of each parameter and
 * classifies each parameter into one of four region types:
 *
 *   STABLE   — the metric stays consistently above-median with low local variance.
 *               Low CV across all values: CV < 0.25.
 *
 *   ISLAND   — an isolated zone of high performance surrounded by much lower
 *               values.  Detected when there is a contiguous run of values above
 *               baseline + 1.5·σ whose neighbours drop sharply below the median.
 *               Classic over-fit fingerprint.
 *
 *   CLIFF    — a large abrupt drop between two adjacent parameter values.
 *               Detected when |metric[i+1] − metric[i]| > 1.5·σ_overall.
 *
 *   UNSTABLE — high local variance (CV ≥ 0.5) without the isolated pattern
 *               of an island.
 *
 * Each parameter produces exactly one region descriptor; the type reflects the
 * dominant character of that parameter's metric surface.
 */
@Injectable()
export class ParameterRegionDetectorService {
  // Thresholds (all tunable)
  private static readonly CLIFF_SIGMA = 1.5; // adjacent drop > N·σ → cliff
  private static readonly ISLAND_SIGMA = 1.5; // peak above baseline + N·σ
  private static readonly STABLE_CV = 0.25; // CV < threshold → stable
  private static readonly UNSTABLE_CV = 0.5; // CV ≥ threshold → unstable

  detect(results: SweepResultEntry[]): ParameterRegionReport {
    if (results.length === 0) {
      return {
        regions: [],
        cliffs: [],
        islands: [],
        stableRegions: [],
        unstableRegions: [],
        hasFragilitySignals: false,
      };
    }

    const paramNames = Object.keys(results[0].params);
    const regions: ParameterRegion[] = paramNames.map((name) => this.analyzeParam(name, results));

    const cliffs = regions.filter((r) => r.type === 'CLIFF');
    const islands = regions.filter((r) => r.type === 'ISLAND');
    const stableRegions = regions.filter((r) => r.type === 'STABLE');
    const unstableRegions = regions.filter((r) => r.type === 'UNSTABLE');

    return {
      regions,
      cliffs,
      islands,
      stableRegions,
      unstableRegions,
      hasFragilitySignals: cliffs.length > 0 || islands.length > 0,
    };
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private analyzeParam(paramName: string, results: SweepResultEntry[]): ParameterRegion {
    // Build marginal curve: average Sharpe per distinct param value
    const groups = new Map<number, number[]>();
    for (const r of results) {
      const val = r.params[paramName];
      if (val === undefined) continue;
      const bucket = groups.get(val) ?? [];
      bucket.push(r.metrics.sharpe);
      groups.set(val, bucket);
    }

    const paramValues = Array.from(groups.keys()).sort((a, b) => a - b);
    const metrics = paramValues.map((v) => mean(groups.get(v)!));

    const overallMean = mean(metrics);
    const overallStd = stdDev(metrics, 0);
    const cv =
      overallMean !== 0 ? overallStd / Math.abs(overallMean) : overallStd > 0 ? Infinity : 0;

    const type = this.classify(metrics, overallMean, overallStd, cv);
    const description = this.describe(
      paramName,
      type,
      metrics,
      paramValues,
      overallMean,
      overallStd,
    );

    return {
      type,
      paramName,
      paramValues,
      metrics,
      meanMetric: overallMean,
      stdMetric: overallStd,
      description,
    };
  }

  private classify(
    metrics: number[],
    overallMean: number,
    overallStd: number,
    cv: number,
  ): ParameterRegionType {
    if (metrics.length < 2) return 'STABLE';

    // ── 0. Stable first: very low CV wins regardless of absolute diffs ────────
    // This prevents spurious CLIFF detection when all values are tightly
    // clustered (σ is tiny, so even 0.01 differences look like N·σ).
    if (cv < ParameterRegionDetectorService.STABLE_CV) return 'STABLE';

    // ── 1. Cliff: any adjacent drop > 1.5·σ ──────────────────────────────────
    for (let i = 0; i < metrics.length - 1; i++) {
      if (
        Math.abs(metrics[i + 1] - metrics[i]) >
        ParameterRegionDetectorService.CLIFF_SIGMA * overallStd
      ) {
        return 'CLIFF';
      }
    }

    // ── 2. Island: isolated peak above baseline + 1.5·σ ──────────────────────
    if (this.hasIsland(metrics, overallMean, overallStd)) return 'ISLAND';

    // ── 3. Unstable based on CV ───────────────────────────────────────────────
    if (cv >= ParameterRegionDetectorService.UNSTABLE_CV) return 'UNSTABLE';

    return 'STABLE'; // moderate CV defaults to stable
  }

  /**
   * Island: there exists a contiguous run of values above (baseline + threshold)
   * where the immediately surrounding neighbours (if they exist) are below the
   * baseline. This captures "lucky pocket" regions.
   */
  private hasIsland(metrics: number[], baseline: number, σ: number): boolean {
    if (σ === 0 || metrics.length < 3) return false;
    const high = baseline + ParameterRegionDetectorService.ISLAND_SIGMA * σ;

    // Find runs of values above `high`
    let i = 0;
    while (i < metrics.length) {
      if (metrics[i] >= high) {
        // Run starts at i — find its end
        let j = i;
        while (j < metrics.length && metrics[j] >= high) j++;
        // Island: run is a strict interior subset (not at both edges)
        const leftBelow = i > 0 && metrics[i - 1] < baseline;
        const rightBelow = j < metrics.length && metrics[j] < baseline;
        if (leftBelow && rightBelow) return true;
        i = j;
      } else {
        i++;
      }
    }
    return false;
  }

  private describe(
    paramName: string,
    type: ParameterRegionType,
    metrics: number[],
    paramValues: number[],
    overallMean: number,
    overallStd: number,
  ): string {
    switch (type) {
      case 'CLIFF': {
        let maxDrop = 0;
        let cliffAt = paramValues[0];
        for (let i = 0; i < metrics.length - 1; i++) {
          const drop = Math.abs(metrics[i + 1] - metrics[i]);
          if (drop > maxDrop) {
            maxDrop = drop;
            cliffAt = paramValues[i];
          }
        }
        return (
          `Cliff: metric drops ${maxDrop.toFixed(2)} (${(maxDrop / (overallStd || 1)).toFixed(1)}σ)` +
          ` between param values ${cliffAt} and ${paramValues[paramValues.indexOf(cliffAt) + 1]}`
        );
      }
      case 'ISLAND': {
        const high = overallMean + ParameterRegionDetectorService.ISLAND_SIGMA * overallStd;
        const peakVals = paramValues.filter((_, i) => metrics[i] >= high);
        return (
          `Island: isolated high-performance region at ${paramName} ∈ [${peakVals[0]}, ${peakVals[peakVals.length - 1]}]` +
          ` — likely overfit pocket`
        );
      }
      case 'UNSTABLE':
        return (
          `Unstable: metric varies erratically across ${paramName}` +
          ` (CV=${((overallStd / (Math.abs(overallMean) || 1)) * 100).toFixed(0)} %)`
        );
      case 'STABLE':
        return `Stable: ${paramName} performs consistently across its range (CV=${((overallStd / (Math.abs(overallMean) || 1)) * 100).toFixed(0)} %)`;
    }
  }
}
