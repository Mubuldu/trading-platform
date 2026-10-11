import { Injectable } from '@nestjs/common';
import { EquityCurvePoint } from '../../../domain/models/equity-curve-point.model';
import { TradeRecord } from '../../../domain/models/trade-record.model';

export interface RiskMetrics {
  readonly sharpeRatio: number;
  readonly sortinoRatio: number;
  readonly calmarRatio: number;
  readonly maxConsecutiveWins: number;
  readonly maxConsecutiveLosses: number;
  readonly averageMaePercent: number;
  readonly averageMfePercent: number;
}

const RISK_FREE_RATE_ANNUAL = 0.05;

@Injectable()
export class RiskMetricsCalculatorService {
  compute(
    equityCurve: EquityCurvePoint[],
    trades: TradeRecord[],
    annualizedReturnPercent: number,
    maxDrawdownPercent: number,
  ): RiskMetrics {
    const dailyReturns = this.computeDailyReturns(equityCurve);

    const sharpe = this.computeSharpe(dailyReturns);
    const sortino = this.computeSortino(dailyReturns);
    const calmar = maxDrawdownPercent > 0 ? annualizedReturnPercent / maxDrawdownPercent : 0;

    const { maxWins, maxLosses } = this.computeConsecutive(trades);
    const avgMae =
      trades.length > 0 ? trades.reduce((s, t) => s + t.maePercent, 0) / trades.length : 0;
    const avgMfe =
      trades.length > 0 ? trades.reduce((s, t) => s + t.mfePercent, 0) / trades.length : 0;

    return {
      sharpeRatio: sharpe,
      sortinoRatio: sortino,
      calmarRatio: calmar,
      maxConsecutiveWins: maxWins,
      maxConsecutiveLosses: maxLosses,
      averageMaePercent: avgMae,
      averageMfePercent: avgMfe,
    };
  }

  private computeDailyReturns(equityCurve: EquityCurvePoint[]): number[] {
    const dayBuckets = new Map<number, number>();
    for (const p of equityCurve) {
      const day = Math.floor(p.timestamp / 86_400_000);
      dayBuckets.set(day, p.equity);
    }

    const days = [...dayBuckets.entries()].sort(([a], [b]) => a - b);
    if (days.length < 2) return [];

    const returns: number[] = [];
    for (let i = 1; i < days.length; i++) {
      const prev = days[i - 1][1];
      const curr = days[i][1];
      if (prev > 0) returns.push((curr - prev) / prev);
    }
    return returns;
  }

  private computeSharpe(dailyReturns: number[]): number {
    if (dailyReturns.length < 2) return 0;

    const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
    const riskFreeDaily = RISK_FREE_RATE_ANNUAL / 252;
    const excessMean = mean - riskFreeDaily;

    const variance =
      dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (dailyReturns.length - 1);
    const std = Math.sqrt(variance);

    if (std === 0) return 0;
    return (excessMean / std) * Math.sqrt(252);
  }

  private computeSortino(dailyReturns: number[]): number {
    if (dailyReturns.length < 2) return 0;

    const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
    const riskFreeDaily = RISK_FREE_RATE_ANNUAL / 252;
    const excessMean = mean - riskFreeDaily;

    const negativeReturns = dailyReturns.filter((r) => r < 0);
    if (negativeReturns.length === 0) return excessMean > 0 ? Infinity : 0;

    const downsideVariance = negativeReturns.reduce((s, r) => s + r ** 2, 0) / dailyReturns.length;
    const downsideStd = Math.sqrt(downsideVariance);

    if (downsideStd === 0) return 0;
    return (excessMean / downsideStd) * Math.sqrt(252);
  }

  private computeConsecutive(trades: TradeRecord[]): { maxWins: number; maxLosses: number } {
    let maxWins = 0;
    let maxLosses = 0;
    let currentWins = 0;
    let currentLosses = 0;

    for (const trade of trades) {
      if (trade.netPnl > 0) {
        currentWins++;
        currentLosses = 0;
        maxWins = Math.max(maxWins, currentWins);
      } else if (trade.netPnl < 0) {
        currentLosses++;
        currentWins = 0;
        maxLosses = Math.max(maxLosses, currentLosses);
      } else {
        currentWins = 0;
        currentLosses = 0;
      }
    }

    return { maxWins, maxLosses };
  }
}
