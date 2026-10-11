import { Injectable } from '@nestjs/common';
import { AnalyticsTrade } from '../../domain/models/analytics-trade.model';
import { PerformanceMetrics } from '../../domain/models/performance-metrics.model';

const MS_PER_YEAR = 365.25 * 24 * 3_600_000;

/**
 * PerformanceCalculator computes all core trade-level performance statistics.
 *
 * This is a pure, stateless service — it depends on no external I/O.
 * Every public method is idempotent: identical inputs always produce identical outputs.
 *
 * Numeric edge cases:
 *   - 0 trades          → all counts and ratios return 0; no Infinity is produced
 *   - profitFactor      → Infinity when grossLoss = 0 and grossProfit > 0
 *   - recoveryFactor    → 0 when maxAbsoluteDrawdown = 0 (never in drawdown)
 *   - payoffRatio       → Infinity when averageLoss = 0 and averageWin > 0
 *   - riskRewardRatio   → Infinity when averageWin = 0 and averageLoss > 0
 */
@Injectable()
export class PerformanceCalculator {
  compute(
    trades: AnalyticsTrade[],
    initialCapital: number,
    finalEquity: number,
    startTime: number,
    endTime: number,
    maxAbsoluteDrawdown = 0,
  ): PerformanceMetrics {
    const winners = trades.filter((t) => t.netPnl > 0);
    const losers = trades.filter((t) => t.netPnl < 0);
    const breakEvens = trades.filter((t) => t.netPnl === 0);

    const grossProfit = winners.reduce((s, t) => s + t.netPnl, 0);
    const grossLoss = Math.abs(losers.reduce((s, t) => s + t.netPnl, 0));
    const netProfit = finalEquity - initialCapital;

    const averageWin = winners.length > 0 ? grossProfit / winners.length : 0;
    const averageLoss = losers.length > 0 ? grossLoss / losers.length : 0;

    const pnls = trades.map((t) => t.netPnl);
    const medianTrade = this.median(pnls);
    const averageTrade = trades.length > 0 ? netProfit / trades.length : 0;

    const largestWin = winners.length > 0 ? Math.max(...winners.map((t) => t.netPnl)) : 0;
    const largestLoss = losers.length > 0 ? Math.max(...losers.map((t) => Math.abs(t.netPnl))) : 0;

    const winningPercent = trades.length > 0 ? winners.length / trades.length : 0;
    const losingPercent = trades.length > 0 ? losers.length / trades.length : 0;

    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    // expectancy = (winRate × averageWin) - (lossRate × averageLoss)
    const expectancy = winningPercent * averageWin - losingPercent * averageLoss;

    const recoveryFactor = maxAbsoluteDrawdown > 0 ? netProfit / maxAbsoluteDrawdown : 0;
    const payoffRatio = averageLoss > 0 ? averageWin / averageLoss : averageWin > 0 ? Infinity : 0;
    const riskRewardRatio =
      averageWin > 0 ? averageLoss / averageWin : averageLoss > 0 ? Infinity : 0;

    const totalReturnPercent = initialCapital > 0 ? (netProfit / initialCapital) * 100 : 0;
    const durationMs = Math.max(endTime - startTime, 1);
    const yearsElapsed = durationMs / MS_PER_YEAR;
    const annualizedReturnPercent =
      yearsElapsed > 0 && initialCapital > 0 && finalEquity > 0
        ? (Math.pow(finalEquity / initialCapital, 1 / yearsElapsed) - 1) * 100
        : 0;

    return {
      initialCapital,
      finalEquity,
      netProfit,
      grossProfit,
      grossLoss,
      totalReturnPercent,
      annualizedReturnPercent,
      averageTrade,
      medianTrade,
      largestWin,
      largestLoss,
      averageWin,
      averageLoss,
      totalTrades: trades.length,
      winningTrades: winners.length,
      losingTrades: losers.length,
      breakEvenTrades: breakEvens.length,
      winningPercent,
      losingPercent,
      expectancy,
      profitFactor,
      recoveryFactor,
      payoffRatio,
      riskRewardRatio,
      computedAt: Date.now(),
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  }
}
