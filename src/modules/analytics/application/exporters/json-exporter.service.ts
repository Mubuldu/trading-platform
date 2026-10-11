import { Injectable } from '@nestjs/common';
import { AnalyticsSnapshot } from '../../domain/models/analytics-snapshot.model';

/**
 * JsonExporterService serialises analytics data to JSON strings.
 *
 * fullSnapshot — the complete AnalyticsSnapshot as indented JSON.
 * metricsOnly  — a trimmed view with only the numeric metrics (no curves).
 *
 * No file I/O is performed — callers receive the raw string.
 */
@Injectable()
export class JsonExporterService {
  exportFullSnapshot(snapshot: AnalyticsSnapshot): string {
    return JSON.stringify(snapshot, this.jsonReplacer, 2);
  }

  exportMetricsOnly(snapshot: AnalyticsSnapshot): string {
    const slim = {
      snapshotId: snapshot.snapshotId,
      sessionId: snapshot.sessionId,
      computedAt: snapshot.computedAt,
      performance: snapshot.performance,
      riskMetrics: snapshot.riskMetrics,
      tradeMetrics: snapshot.tradeMetrics,
      executionAnalytics: snapshot.executionAnalytics,
      rollingMetrics: {
        sevenDay: this.trimWindow(snapshot.rollingMetrics.sevenDay),
        thirtyDay: this.trimWindow(snapshot.rollingMetrics.thirtyDay),
        ninetyDay: this.trimWindow(snapshot.rollingMetrics.ninetyDay),
        oneEightyDay: this.trimWindow(snapshot.rollingMetrics.oneEightyDay),
        threeSixtyFiveDay: this.trimWindow(snapshot.rollingMetrics.threeSixtyFiveDay),
      },
      benchmarkComparisons: snapshot.benchmarkComparisons,
      exposureMetrics: {
        grossExposure: snapshot.exposureMetrics.grossExposure,
        netExposure: snapshot.exposureMetrics.netExposure,
        longExposure: snapshot.exposureMetrics.longExposure,
        shortExposure: snapshot.exposureMetrics.shortExposure,
        bySymbol: snapshot.exposureMetrics.bySymbol,
        byStrategy: snapshot.exposureMetrics.byStrategy,
        byExchange: snapshot.exposureMetrics.byExchange,
        longPositionCount: snapshot.exposureMetrics.longPositionCount,
        shortPositionCount: snapshot.exposureMetrics.shortPositionCount,
        totalPositionCount: snapshot.exposureMetrics.totalPositionCount,
        snapshotAt: snapshot.exposureMetrics.snapshotAt,
      },
      capitalMetricsSummary: {
        currentEquity: snapshot.capitalMetrics.currentEquity,
        currentBalance: snapshot.capitalMetrics.currentBalance,
        buyingPower: snapshot.capitalMetrics.buyingPower,
        marginUsed: snapshot.capitalMetrics.marginUsed,
        marginUtilizationPercent: snapshot.capitalMetrics.marginUtilizationPercent,
        leverageUtilization: snapshot.capitalMetrics.leverageUtilization,
        cashUtilizationPercent: snapshot.capitalMetrics.cashUtilizationPercent,
        snapshotAt: snapshot.capitalMetrics.snapshotAt,
      },
    };

    return JSON.stringify(slim, this.jsonReplacer, 2);
  }

  exportEquityCurve(snapshot: AnalyticsSnapshot): string {
    return JSON.stringify(
      {
        snapshotId: snapshot.snapshotId,
        computedAt: snapshot.computedAt,
        equityCurve: snapshot.capitalMetrics.equityCurve,
        balanceCurve: snapshot.capitalMetrics.balanceCurve,
      },
      this.jsonReplacer,
      2,
    );
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private trimWindow(w: object): object {
    // Exclude per-window computedAt to keep output clean
    const { ...rest } = w as Record<string, unknown>;
    return rest;
  }

  /**
   * JSON replacer: converts Infinity/NaN to human-readable strings so the
   * output is valid JSON (JSON.stringify would produce null otherwise).
   */
  private readonly jsonReplacer = (_key: string, value: unknown): unknown => {
    if (typeof value === 'number') {
      if (!isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity';
      if (isNaN(value)) return 'NaN';
    }
    return value;
  };
}
