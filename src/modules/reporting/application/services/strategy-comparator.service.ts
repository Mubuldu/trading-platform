import { Injectable } from '@nestjs/common';
import { AnalyticsStorageService } from '@modules/analytics/storage/analytics-storage.service';
import { AnalyticsSnapshot } from '@modules/analytics/domain/models/analytics-snapshot.model';
import { StrategyMetricRow } from '../../domain/models/sections/strategy-comparison.section';
import { StrategyComparisonResult } from '../../domain/models/strategy-comparison-result.model';
import { StrategySnapshotNotFoundError } from '../../domain/errors/reporting.errors';

/**
 * StrategyComparatorService compares multiple strategies side-by-side.
 *
 * Inputs:
 *   - A list of strategyIds to compare.
 *   - A list of AnalyticsSnapshot objects pre-filtered to the report period.
 *
 * For each strategyId, the service selects the most recent snapshot tagged
 * with that strategyId. If none exists, it throws StrategySnapshotNotFoundError.
 *
 * The "winner" for each metric is the strategyId that has the best value:
 *   bestByReturn  — highest totalReturnPercent
 *   bestBySharpe  — highest sharpeRatio
 *   bestBySortino — highest sortinoRatio
 *   bestByCalmar  — highest calmarRatio
 *   bestByDrawdown— lowest maxDrawdownPercent
 *   bestByExpectancy  — highest expectancy
 *   bestByProfitFactor — highest profitFactor
 */
@Injectable()
export class StrategyComparatorService {
  constructor(private readonly analyticsStorage: AnalyticsStorageService) {}

  /**
   * Compare multiple strategies using their latest available snapshots.
   *
   * @param strategyIds — list of strategy IDs to compare (≥ 2)
   * @param snapshots   — pre-fetched snapshots for the relevant period;
   *                      if empty, the service falls back to all stored snapshots
   */
  async compare(
    strategyIds: string[],
    snapshots: AnalyticsSnapshot[],
  ): Promise<StrategyComparisonResult> {
    if (strategyIds.length < 2) {
      throw new Error(
        `StrategyComparatorService requires at least 2 strategy IDs; got ${strategyIds.length}`,
      );
    }

    // If no snapshots were provided, load from storage
    const pool = snapshots.length > 0 ? snapshots : await this.analyticsStorage.loadSnapshots(500);

    const rows = strategyIds.map((id) => {
      const snap = this.pickBest(pool, id);
      return this.toMetricRow(id, snap);
    });

    return {
      strategies: rows,
      bestByReturn: this.winnerBy(rows, (r) => r.totalReturnPercent),
      bestBySharpe: this.winnerBy(rows, (r) => r.sharpeRatio),
      bestBySortino: this.winnerBy(rows, (r) => r.sortinoRatio),
      bestByCalmar: this.winnerBy(rows, (r) => r.calmarRatio),
      bestByDrawdown: this.winnerBy(rows, (r) => -r.maxDrawdownPercent), // lowest DD wins
      bestByExpectancy: this.winnerBy(rows, (r) => r.expectancy),
      bestByProfitFactor: this.winnerBy(rows, (r) => r.profitFactor),
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * From the snapshot pool, pick the most recent snapshot tagged with strategyId.
   * Falls back to the portfolio-level latest snapshot if no per-strategy one exists.
   */
  private pickBest(pool: AnalyticsSnapshot[], strategyId: string): AnalyticsSnapshot {
    const matches = pool
      .filter((s) => s.strategyId === strategyId)
      .sort((a, b) => b.computedAt - a.computedAt);

    if (matches.length > 0) return matches[0]!;

    // No per-strategy snapshot — check if strategyId matches the sessionId instead
    const sessionMatches = pool
      .filter((s) => s.sessionId === strategyId)
      .sort((a, b) => b.computedAt - a.computedAt);

    if (sessionMatches.length > 0) return sessionMatches[0]!;

    throw new StrategySnapshotNotFoundError(strategyId);
  }

  private toMetricRow(strategyId: string, snap: AnalyticsSnapshot): StrategyMetricRow {
    const { performance: p, riskMetrics: r } = snap;
    return {
      strategyId,
      strategyLabel: strategyId, // callers can override labels externally
      netProfit: p.netProfit,
      totalReturnPercent: p.totalReturnPercent,
      annualizedReturnPercent: p.annualizedReturnPercent,
      sharpeRatio: r.sharpeRatio,
      sortinoRatio: r.sortinoRatio,
      calmarRatio: r.calmarRatio,
      maxDrawdownPercent: r.maxDrawdown * 100,
      totalTrades: p.totalTrades,
      winRate: p.winningPercent,
      expectancy: p.expectancy,
      profitFactor: p.profitFactor,
    };
  }

  /** Returns the strategyId of the row with the highest value of the given accessor. */
  private winnerBy(rows: StrategyMetricRow[], accessor: (r: StrategyMetricRow) => number): string {
    if (rows.length === 0) return '';
    let best = rows[0]!;
    for (const row of rows) {
      if (isFinite(accessor(row)) && accessor(row) > accessor(best)) {
        best = row;
      }
    }
    return best.strategyId;
  }
}
