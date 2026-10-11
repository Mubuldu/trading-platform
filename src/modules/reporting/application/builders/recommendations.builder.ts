import { Injectable } from '@nestjs/common';
import { AnalyticsSnapshot } from '@modules/analytics/domain/models/analytics-snapshot.model';
import {
  Recommendation,
  RecommendationCategory,
  RecommendationPriority,
  RecommendationsSection,
} from '../../domain/models/sections/recommendations.section';

/**
 * RecommendationsBuilder generates actionable insights by applying
 * threshold-based rules to the analytics snapshot.
 *
 * Rules are defined as pure functions; adding a rule means adding a method
 * that returns Recommendation | null.
 *
 * Thresholds (industry convention):
 *   Sharpe < 0.5 → HIGH RISK; 0.5–1.0 → MEDIUM PERFORMANCE
 *   Sortino < 1.0 → MEDIUM RISK
 *   Max Drawdown > 20% → HIGH RISK; 10–20% → MEDIUM RISK
 *   Win rate < 40% → MEDIUM PERFORMANCE
 *   Profit factor < 1.2 → MEDIUM PERFORMANCE
 *   Fill rate < 90% → MEDIUM EXECUTION
 *   Total slippage > 5% of PnL → MEDIUM EXECUTION
 *   Gross exposure > 100% equity → HIGH EXPOSURE
 *   Cash utilisation > 90% → MEDIUM EXPOSURE
 */
@Injectable()
export class RecommendationsBuilder {
  build(snapshot: AnalyticsSnapshot): RecommendationsSection {
    const { performance: p, riskMetrics: r, executionAnalytics: ex, exposureMetrics: e } = snapshot;
    const netPnlAbs = Math.abs(p.netProfit);

    const items: Recommendation[] = [];

    // ── Risk rules ─────────────────────────────────────────────────────────────
    const rule = (rec: Recommendation | null): void => {
      if (rec) items.push(rec);
    };

    rule(this.checkSharpe(r.sharpeRatio));
    rule(this.checkSortino(r.sortinoRatio));
    rule(this.checkMaxDrawdown(r.maxDrawdown));
    rule(this.checkCalmar(r.calmarRatio));

    // ── Performance rules ──────────────────────────────────────────────────────
    rule(this.checkWinRate(p.winningPercent));
    rule(this.checkProfitFactor(p.profitFactor));
    rule(this.checkExpectancy(p.expectancy));

    // ── Execution rules ────────────────────────────────────────────────────────
    rule(this.checkFillRate(ex.orderFillRate));
    rule(this.checkSlippage(ex.totalSlippage, netPnlAbs));

    // ── Exposure rules ─────────────────────────────────────────────────────────
    rule(this.checkGrossExposure(e.grossExposure, snapshot.capitalMetrics.currentEquity));
    rule(this.checkCashUtilisation(snapshot.capitalMetrics.cashUtilizationPercent));

    // Sort by priority: HIGH first
    const priorityOrder: Record<RecommendationPriority, number> = {
      HIGH: 0,
      MEDIUM: 1,
      LOW: 2,
    };
    items.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    const riskAlerts = items
      .filter(
        (i) =>
          i.priority === RecommendationPriority.HIGH && i.category === RecommendationCategory.RISK,
      )
      .map((i) => i.message);

    return {
      items,
      riskAlerts,
      totalItems: items.length,
      highPriorityCount: items.filter((i) => i.priority === RecommendationPriority.HIGH).length,
      mediumPriorityCount: items.filter((i) => i.priority === RecommendationPriority.MEDIUM).length,
      lowPriorityCount: items.filter((i) => i.priority === RecommendationPriority.LOW).length,
    };
  }

  // ── Rule implementations ───────────────────────────────────────────────────

  private checkSharpe(sharpe: number): Recommendation | null {
    if (!isFinite(sharpe)) return null;
    if (sharpe < 0) {
      return {
        priority: RecommendationPriority.HIGH,
        category: RecommendationCategory.RISK,
        message:
          'Sharpe ratio is negative — the strategy is destroying risk-adjusted value. Review position sizing and entry rules.',
        dataPoint: `Sharpe: ${sharpe.toFixed(2)} (threshold: ≥ 0)`,
      };
    }
    if (sharpe < 0.5) {
      return {
        priority: RecommendationPriority.HIGH,
        category: RecommendationCategory.RISK,
        message:
          'Sharpe ratio is critically low. Consider reducing leverage or improving signal quality.',
        dataPoint: `Sharpe: ${sharpe.toFixed(2)} (threshold: ≥ 0.5)`,
      };
    }
    if (sharpe < 1.0) {
      return {
        priority: RecommendationPriority.MEDIUM,
        category: RecommendationCategory.PERFORMANCE,
        message:
          'Sharpe ratio is below 1.0. Strategy is taking more risk than the return justifies.',
        dataPoint: `Sharpe: ${sharpe.toFixed(2)} (threshold: ≥ 1.0)`,
      };
    }
    return null;
  }

  private checkSortino(sortino: number): Recommendation | null {
    if (!isFinite(sortino) || sortino >= 1.0) return null;
    return {
      priority: sortino < 0 ? RecommendationPriority.HIGH : RecommendationPriority.MEDIUM,
      category: RecommendationCategory.RISK,
      message: 'Sortino ratio is below 1.0 — downside volatility exceeds acceptable levels.',
      dataPoint: `Sortino: ${sortino.toFixed(2)} (threshold: ≥ 1.0)`,
    };
  }

  private checkMaxDrawdown(dd: number): Recommendation | null {
    if (dd > 0.2) {
      return {
        priority: RecommendationPriority.HIGH,
        category: RecommendationCategory.RISK,
        message: `Maximum drawdown exceeds 20%. Immediate risk review recommended — consider hard drawdown stops.`,
        dataPoint: `Max Drawdown: ${(dd * 100).toFixed(2)}% (threshold: ≤ 20%)`,
      };
    }
    if (dd > 0.1) {
      return {
        priority: RecommendationPriority.MEDIUM,
        category: RecommendationCategory.RISK,
        message: 'Maximum drawdown is between 10–20%. Review stop-loss placement.',
        dataPoint: `Max Drawdown: ${(dd * 100).toFixed(2)}% (threshold: ≤ 10%)`,
      };
    }
    return null;
  }

  private checkCalmar(calmar: number): Recommendation | null {
    if (!isFinite(calmar) || calmar >= 1.0) return null;
    return {
      priority: RecommendationPriority.LOW,
      category: RecommendationCategory.PERFORMANCE,
      message:
        'Calmar ratio is below 1.0 — the annualised return does not adequately compensate for drawdown risk.',
      dataPoint: `Calmar: ${calmar.toFixed(2)} (threshold: ≥ 1.0)`,
    };
  }

  private checkWinRate(winRate: number): Recommendation | null {
    if (winRate < 0.4) {
      return {
        priority: RecommendationPriority.MEDIUM,
        category: RecommendationCategory.PERFORMANCE,
        message:
          'Win rate is below 40%. Ensure profit factor compensates, or review trade filtering.',
        dataPoint: `Win Rate: ${(winRate * 100).toFixed(1)}% (threshold: ≥ 40%)`,
      };
    }
    return null;
  }

  private checkProfitFactor(pf: number): Recommendation | null {
    if (!isFinite(pf) || pf >= 1.2) return null;
    const priority = pf < 1.0 ? RecommendationPriority.HIGH : RecommendationPriority.MEDIUM;
    return {
      priority,
      category: RecommendationCategory.PERFORMANCE,
      message:
        pf < 1.0
          ? 'Profit factor is below 1.0 — gross losses exceed gross profits. Strategy is unprofitable.'
          : 'Profit factor is below 1.2. Marginal edge; reduce commissions or tighten entries.',
      dataPoint: `Profit Factor: ${pf.toFixed(2)} (threshold: ≥ 1.2)`,
    };
  }

  private checkExpectancy(expectancy: number): Recommendation | null {
    if (expectancy >= 0) return null;
    return {
      priority: RecommendationPriority.HIGH,
      category: RecommendationCategory.PERFORMANCE,
      message:
        'Expectancy is negative — on average each trade loses money. Fundamental strategy review required.',
      dataPoint: `Expectancy: ${expectancy.toFixed(2)} (threshold: ≥ 0)`,
    };
  }

  private checkFillRate(fillRate: number): Recommendation | null {
    if (fillRate >= 0.9) return null;
    return {
      priority: fillRate < 0.75 ? RecommendationPriority.HIGH : RecommendationPriority.MEDIUM,
      category: RecommendationCategory.EXECUTION,
      message: `Order fill rate is ${(fillRate * 100).toFixed(1)}%. Review order types and market liquidity.`,
      dataPoint: `Fill Rate: ${(fillRate * 100).toFixed(1)}% (threshold: ≥ 90%)`,
    };
  }

  private checkSlippage(totalSlippage: number, netPnlAbs: number): Recommendation | null {
    if (netPnlAbs <= 0 || !isFinite(totalSlippage)) return null;
    const ratio = Math.abs(totalSlippage) / netPnlAbs;
    if (ratio < 0.05) return null;
    return {
      priority: ratio > 0.15 ? RecommendationPriority.HIGH : RecommendationPriority.MEDIUM,
      category: RecommendationCategory.EXECUTION,
      message: `Total slippage is ${(ratio * 100).toFixed(1)}% of net profit. Use limit orders or split large orders.`,
      dataPoint: `Slippage/PnL: ${(ratio * 100).toFixed(1)}% (threshold: ≤ 5%)`,
    };
  }

  private checkGrossExposure(grossExposure: number, equity: number): Recommendation | null {
    if (equity <= 0) return null;
    const ratio = grossExposure / equity;
    if (ratio <= 1.0) return null;
    return {
      priority: ratio > 2.0 ? RecommendationPriority.HIGH : RecommendationPriority.MEDIUM,
      category: RecommendationCategory.EXPOSURE,
      message: `Gross exposure is ${ratio.toFixed(1)}× equity. Review leverage limits.`,
      dataPoint: `Gross Exposure: ${(ratio * 100).toFixed(0)}% of equity (threshold: ≤ 100%)`,
    };
  }

  private checkCashUtilisation(cashUtil: number): Recommendation | null {
    if (cashUtil <= 0.9) return null;
    return {
      priority: RecommendationPriority.MEDIUM,
      category: RecommendationCategory.EXPOSURE,
      message:
        'Cash utilisation exceeds 90%. Maintain a buffer for margin calls and new opportunities.',
      dataPoint: `Cash Utilisation: ${(cashUtil * 100).toFixed(1)}% (threshold: ≤ 90%)`,
    };
  }
}
