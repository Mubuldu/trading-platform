import { Injectable } from '@nestjs/common';
import { AnalyticsSnapshot } from '@modules/analytics/domain/models/analytics-snapshot.model';
import { RiskMetricsSection } from '../../domain/models/sections/risk-metrics.section';

/**
 * RiskSectionBuilder assembles the risk-adjusted performance section.
 */
@Injectable()
export class RiskSectionBuilder {
  build(snapshot: AnalyticsSnapshot): RiskMetricsSection {
    const { riskMetrics: r, rollingMetrics: rm } = snapshot;

    return {
      sharpeRatio: r.sharpeRatio,
      sortinoRatio: r.sortinoRatio,
      calmarRatio: r.calmarRatio,
      omegaRatio: r.omegaRatio,
      treynorRatio: r.treynorRatio,
      informationRatio: r.informationRatio,

      maxDrawdown: r.maxDrawdown,
      maxDrawdownPercent: r.maxDrawdown * 100,
      maxDrawdownAbsolute: r.maxDrawdownAbsolute,
      averageDrawdown: r.averageDrawdown,
      ulcerIndex: r.ulcerIndex,
      painIndex: r.painIndex,

      // Rolling Sharpe
      rolling7dSharpe: r.rollingSharpe7d,
      rolling30dSharpe: r.rollingSharpe30d,
      rolling90dSharpe: r.rollingSharpe90d,

      // Rolling Sortino
      rolling7dSortino: r.rollingSortino7d,
      rolling30dSortino: r.rollingSortino30d,
      rolling90dSortino: r.rollingSortino90d,

      // Rolling returns
      rolling7dReturnPercent: rm.sevenDay.totalReturnPercent,
      rolling30dReturnPercent: rm.thirtyDay.totalReturnPercent,
      rolling90dReturnPercent: rm.ninetyDay.totalReturnPercent,
      rolling180dReturnPercent: rm.oneEightyDay.totalReturnPercent,
      rolling365dReturnPercent: rm.threeSixtyFiveDay.totalReturnPercent,

      // Volatility
      daily7dVolatility: rm.sevenDay.dailyVolatility,
      daily30dVolatility: rm.thirtyDay.dailyVolatility,
      annualizedVolatility: rm.thirtyDay.annualizedVolatility,
    };
  }
}
