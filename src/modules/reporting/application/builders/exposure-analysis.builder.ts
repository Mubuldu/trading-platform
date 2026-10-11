import { Injectable } from '@nestjs/common';
import { AnalyticsSnapshot } from '@modules/analytics/domain/models/analytics-snapshot.model';
import { ExposureAnalysisSection } from '../../domain/models/sections/exposure-analysis.section';

/**
 * ExposureAnalysisBuilder assembles the portfolio exposure breakdown section.
 */
@Injectable()
export class ExposureAnalysisBuilder {
  private static readonly TOP_N_SYMBOLS = 10;

  build(snapshot: AnalyticsSnapshot): ExposureAnalysisSection {
    const { exposureMetrics: e, capitalMetrics: c } = snapshot;

    const topSymbolsByExposure = Object.entries(e.bySymbol)
      .map(([symbol, v]) => ({
        symbol,
        direction: v.direction,
        notional: v.notional,
        percentOfEquity: v.percentOfEquity,
        unrealizedPnl: v.unrealizedPnl,
      }))
      .sort((a, b) => b.notional - a.notional)
      .slice(0, ExposureAnalysisBuilder.TOP_N_SYMBOLS);

    const exposureByStrategy = Object.entries(e.byStrategy)
      .map(([strategyId, v]) => ({
        strategyId,
        notional: v.notional,
        percentOfEquity: v.percentOfEquity,
        positionCount: v.positionCount,
      }))
      .sort((a, b) => b.notional - a.notional);

    return {
      grossExposure: e.grossExposure,
      netExposure: e.netExposure,
      longExposure: e.longExposure,
      shortExposure: e.shortExposure,

      leverageUtilization: c.leverageUtilization,
      marginUtilizationPercent: c.marginUtilizationPercent,
      cashUtilizationPercent: c.cashUtilizationPercent,

      openPositionCount: e.totalPositionCount,
      longPositionCount: e.longPositionCount,
      shortPositionCount: e.shortPositionCount,

      topSymbolsByExposure,
      exposureByStrategy,
    };
  }
}
