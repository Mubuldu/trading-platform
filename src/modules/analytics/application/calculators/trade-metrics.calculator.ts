import { Injectable } from '@nestjs/common';
import { AnalyticsTrade } from '../../domain/models/analytics-trade.model';
import { TradeMetrics } from '../../domain/models/trade-metrics.model';

const MS_PER_DAY = 86_400_000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/**
 * TradeMetricsCalculator computes time-based and sequencing statistics.
 *
 * barDurationMs — if provided, enables bars-held calculation.
 *                  e.g. 3_600_000 for 1-hour bars, 86_400_000 for daily bars.
 *                  When absent (0), barsHeld values are returned as 0.
 *
 * tradeFrequency is expressed per-day and per-week.
 * If only 1 trade exists the denominator uses its durationMs as elapsed time.
 */
@Injectable()
export class TradeMetricsCalculator {
  compute(trades: AnalyticsTrade[], barDurationMs = 0): TradeMetrics {
    if (trades.length === 0) {
      return this.empty();
    }

    // Sort by exit time to ensure chronological order
    const sorted = [...trades].sort((a, b) => a.exitTime - b.exitTime);
    const firstTradeAt = sorted[0]!.entryTime;
    const lastTradeAt = sorted[sorted.length - 1]!.exitTime;
    const totalPeriodMs = Math.max(lastTradeAt - firstTradeAt, 1);

    // Holding times
    const durations = sorted.map((t) => t.durationMs);
    const averageHoldingTimeMs = durations.reduce((s, d) => s + d, 0) / durations.length;
    const maxHoldingTimeMs = Math.max(...durations);
    const minHoldingTimeMs = Math.min(...durations);

    // Bars held
    const averageBarsHeld = barDurationMs > 0 ? averageHoldingTimeMs / barDurationMs : 0;
    const maxBarsHeld = barDurationMs > 0 ? maxHoldingTimeMs / barDurationMs : 0;

    // Consecutive win/loss streaks
    const { maxConsecutiveWins, maxConsecutiveLosses } = this.computeStreaks(sorted);

    // Longest flat period (gap between consecutive trade exits, no position)
    const longestFlatPeriodMs = this.computeLongestFlat(sorted);

    // Trade frequency
    const periodDays = totalPeriodMs / MS_PER_DAY;
    const periodWeeks = totalPeriodMs / MS_PER_WEEK;
    const tradeFrequencyPerDay = periodDays > 0 ? sorted.length / periodDays : 0;
    const tradeFrequencyPerWeek = periodWeeks > 0 ? sorted.length / periodWeeks : 0;

    return {
      averageHoldingTimeMs,
      maxHoldingTimeMs,
      minHoldingTimeMs,
      averageBarsHeld,
      maxBarsHeld,
      maxConsecutiveWins,
      maxConsecutiveLosses,
      longestFlatPeriodMs,
      tradeFrequencyPerDay,
      tradeFrequencyPerWeek,
      firstTradeAt,
      lastTradeAt,
      totalPeriodMs,
      computedAt: Date.now(),
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private computeStreaks(trades: AnalyticsTrade[]): {
    maxConsecutiveWins: number;
    maxConsecutiveLosses: number;
  } {
    let maxWins = 0;
    let maxLosses = 0;
    let currentWins = 0;
    let currentLosses = 0;

    for (const trade of trades) {
      if (trade.netPnl > 0) {
        currentWins++;
        currentLosses = 0;
        if (currentWins > maxWins) maxWins = currentWins;
      } else if (trade.netPnl < 0) {
        currentLosses++;
        currentWins = 0;
        if (currentLosses > maxLosses) maxLosses = currentLosses;
      } else {
        currentWins = 0;
        currentLosses = 0;
      }
    }

    return { maxConsecutiveWins: maxWins, maxConsecutiveLosses: maxLosses };
  }

  /**
   * Longest flat period = the longest gap between consecutive trade exit times.
   * During a flat period the strategy has no open position.
   */
  private computeLongestFlat(sortedTrades: AnalyticsTrade[]): number {
    if (sortedTrades.length < 2) return 0;
    let longest = 0;
    for (let i = 1; i < sortedTrades.length; i++) {
      const gap = sortedTrades[i]!.entryTime - sortedTrades[i - 1]!.exitTime;
      if (gap > longest) longest = gap;
    }
    return Math.max(0, longest);
  }

  private empty(): TradeMetrics {
    return {
      averageHoldingTimeMs: 0,
      maxHoldingTimeMs: 0,
      minHoldingTimeMs: 0,
      averageBarsHeld: 0,
      maxBarsHeld: 0,
      maxConsecutiveWins: 0,
      maxConsecutiveLosses: 0,
      longestFlatPeriodMs: 0,
      tradeFrequencyPerDay: 0,
      tradeFrequencyPerWeek: 0,
      firstTradeAt: 0,
      lastTradeAt: 0,
      totalPeriodMs: 0,
      computedAt: Date.now(),
    };
  }
}
