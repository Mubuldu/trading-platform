import { Injectable } from '@nestjs/common';
import { AnalyticsSnapshot } from '@modules/analytics/domain/models/analytics-snapshot.model';
import { PortfolioPerformanceSection } from '../../domain/models/sections/portfolio-performance.section';

/**
 * PortfolioPerformanceBuilder assembles the portfolio performance section.
 */
@Injectable()
export class PortfolioPerformanceBuilder {
  build(snapshot: AnalyticsSnapshot): PortfolioPerformanceSection {
    const { performance: p, capitalMetrics: c, executionAnalytics: ex } = snapshot;

    const { peakEquity, peakEquityDate, troughEquity, troughEquityDate, averageEquity } =
      this.computeEquityCurveStats(c.equityCurve);

    return {
      initialCapital: p.initialCapital,
      finalEquity: p.finalEquity,
      currentBalance: c.currentBalance,
      buyingPower: c.buyingPower,

      netProfit: p.netProfit,
      grossProfit: p.grossProfit,
      grossLoss: p.grossLoss,
      realizedPnl: p.netProfit, // approximation: realized = net (unrealized tracked separately)
      unrealizedPnl: c.currentEquity - c.currentBalance,
      totalCommissions: ex.totalCommission,

      totalReturnPercent: p.totalReturnPercent,
      annualizedReturnPercent: p.annualizedReturnPercent,

      averageEquity,
      peakEquity,
      peakEquityDate,
      troughEquity,
      troughEquityDate,

      leverageUtilization: c.leverageUtilization,
      marginUtilizationPercent: c.marginUtilizationPercent,
      cashUtilizationPercent: c.cashUtilizationPercent,

      profitFactor: p.profitFactor,
      recoveryFactor: p.recoveryFactor,
      payoffRatio: p.payoffRatio,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private computeEquityCurveStats(curve: ReadonlyArray<{ date: string; equity: number }>): {
    peakEquity: number;
    peakEquityDate: string;
    troughEquity: number;
    troughEquityDate: string;
    averageEquity: number;
  } {
    if (curve.length === 0) {
      return {
        peakEquity: 0,
        peakEquityDate: '',
        troughEquity: 0,
        troughEquityDate: '',
        averageEquity: 0,
      };
    }

    let peakEquity = -Infinity;
    let peakEquityDate = '';
    let troughEquity = Infinity;
    let troughEquityDate = '';
    let sum = 0;

    for (const point of curve) {
      if (point.equity > peakEquity) {
        peakEquity = point.equity;
        peakEquityDate = point.date;
      }
      if (point.equity < troughEquity) {
        troughEquity = point.equity;
        troughEquityDate = point.date;
      }
      sum += point.equity;
    }

    return {
      peakEquity,
      peakEquityDate,
      troughEquity,
      troughEquityDate,
      averageEquity: sum / curve.length,
    };
  }
}
