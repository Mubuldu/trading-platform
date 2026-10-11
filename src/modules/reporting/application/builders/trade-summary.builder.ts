import { Injectable } from '@nestjs/common';
import { AnalyticsSnapshot } from '@modules/analytics/domain/models/analytics-snapshot.model';
import { TradeSummarySection } from '../../domain/models/sections/trade-summary.section';

/**
 * TradeSummaryBuilder assembles the trade-level statistics section.
 */
@Injectable()
export class TradeSummaryBuilder {
  build(snapshot: AnalyticsSnapshot): TradeSummarySection {
    const { performance: p, tradeMetrics: t } = snapshot;

    return {
      totalTrades: p.totalTrades,
      winningTrades: p.winningTrades,
      losingTrades: p.losingTrades,
      breakEvenTrades: p.breakEvenTrades,
      winRate: p.winningPercent,
      lossRate: p.losingPercent,

      averageTrade: p.averageTrade,
      medianTrade: p.medianTrade,
      largestWin: p.largestWin,
      largestLoss: p.largestLoss,
      averageWin: p.averageWin,
      averageLoss: p.averageLoss,

      profitFactor: p.profitFactor,
      expectancy: p.expectancy,
      payoffRatio: p.payoffRatio,
      riskRewardRatio: p.riskRewardRatio,

      maxConsecutiveWins: t.maxConsecutiveWins,
      maxConsecutiveLosses: t.maxConsecutiveLosses,

      averageHoldingTimeMs: t.averageHoldingTimeMs,
      averageHoldingTimeFormatted: this.formatDuration(t.averageHoldingTimeMs),
      maxHoldingTimeMs: t.maxHoldingTimeMs,
      minHoldingTimeMs: t.minHoldingTimeMs,
      tradeFrequencyPerDay: t.tradeFrequencyPerDay,
      tradeFrequencyPerWeek: t.tradeFrequencyPerWeek,
      longestFlatPeriodMs: t.longestFlatPeriodMs,
      longestFlatPeriodFormatted: this.formatDuration(t.longestFlatPeriodMs),

      firstTradeAt: t.firstTradeAt,
      lastTradeAt: t.lastTradeAt,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Format milliseconds as a human-readable duration string.
   * Examples: "2h 15m", "3d 4h", "45m 30s"
   */
  formatDuration(ms: number): string {
    if (ms <= 0) return '0s';

    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86_400);
    const hours = Math.floor((totalSeconds % 86_400) / 3_600);
    const minutes = Math.floor((totalSeconds % 3_600) / 60);
    const seconds = totalSeconds % 60;

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 && days === 0) parts.push(`${seconds}s`); // suppress seconds when days shown

    return parts.join(' ') || '0s';
  }
}
