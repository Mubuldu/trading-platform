import { Injectable } from '@nestjs/common';
import { DailyPnlRecord } from '../../domain/models/performance.model';
import { RiskMetricsModel } from '../../domain/models/portfolio-metrics.model';

const SQRT_252 = Math.sqrt(252);

@Injectable()
export class PortfolioMetricsService {
  /**
   * Annualized Sharpe ratio.
   * (mean daily return - daily risk-free rate) / std-dev daily returns * sqrt(252)
   */
  computeSharpe(dailyReturns: number[], riskFreeRateAnnual = 0.05, tradingDays = 252): number {
    if (dailyReturns.length < 2) return 0;
    const rfDaily = riskFreeRateAnnual / tradingDays;
    const excess = dailyReturns.map((r) => r - rfDaily);
    const mean = this.mean(excess);
    const std = this.stddev(excess);
    if (std === 0) return 0;
    return (mean / std) * Math.sqrt(tradingDays);
  }

  /**
   * Annualized Sortino ratio — penalises only downside volatility.
   */
  computeSortino(dailyReturns: number[], riskFreeRateAnnual = 0.05, tradingDays = 252): number {
    if (dailyReturns.length < 2) return 0;
    const rfDaily = riskFreeRateAnnual / tradingDays;
    const excess = dailyReturns.map((r) => r - rfDaily);
    const mean = this.mean(excess);
    const negativeExcess = excess.filter((r) => r < 0);
    if (negativeExcess.length === 0) return mean > 0 ? Infinity : 0;
    const downsideStd = Math.sqrt(
      negativeExcess.reduce((sum, r) => sum + r * r, 0) / negativeExcess.length,
    );
    if (downsideStd === 0) return 0;
    return (mean / downsideStd) * Math.sqrt(tradingDays);
  }

  /**
   * Calmar ratio = annualized return / max drawdown (as positive decimal).
   */
  computeCalmar(annualReturnDecimal: number, maxDrawdownDecimal: number): number {
    if (maxDrawdownDecimal <= 0) return annualReturnDecimal > 0 ? Infinity : 0;
    return annualReturnDecimal / maxDrawdownDecimal;
  }

  /**
   * Maximum peak-to-trough drawdown over an equity curve.
   * Returns a positive decimal (e.g. 0.15 = 15% drawdown).
   */
  computeMaxDrawdown(equityCurve: number[]): { relative: number; absolute: number } {
    if (equityCurve.length < 2) return { relative: 0, absolute: 0 };
    let peak = equityCurve[0];
    let maxRelative = 0;
    let maxAbsolute = 0;

    for (const equity of equityCurve) {
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      const ddRel = peak > 0 ? dd / peak : 0;
      if (ddRel > maxRelative) {
        maxRelative = ddRel;
        maxAbsolute = dd;
      }
    }
    return { relative: maxRelative, absolute: maxAbsolute };
  }

  /**
   * Rolling drawdown: current drawdown from the peak within the last `windowDays` days.
   */
  computeRollingDrawdown(equityCurve: number[], windowDays = 30): number {
    if (equityCurve.length === 0) return 0;
    const slice = equityCurve.slice(-windowDays);
    const peak = Math.max(...slice);
    const current = slice[slice.length - 1];
    if (peak <= 0) return 0;
    return (peak - current) / peak;
  }

  /**
   * Annualized volatility (std-dev of daily returns * sqrt(tradingDays)).
   */
  computeVolatility(dailyReturns: number[], tradingDays = 252): number {
    if (dailyReturns.length < 2) return 0;
    return this.stddev(dailyReturns) * Math.sqrt(tradingDays);
  }

  /**
   * Recovery factor = total net profit / max drawdown (absolute).
   */
  computeRecoveryFactor(totalNetProfit: number, maxDrawdownAbsolute: number): number {
    if (maxDrawdownAbsolute <= 0) return totalNetProfit > 0 ? Infinity : 0;
    return totalNetProfit / maxDrawdownAbsolute;
  }

  /**
   * Profit factor = gross profit / gross loss. Values > 1 are profitable.
   */
  computeProfitFactor(grossProfit: number, grossLoss: number): number {
    if (grossLoss <= 0) return grossProfit > 0 ? Infinity : 0;
    return grossProfit / grossLoss;
  }

  /**
   * Expectancy per trade = (win% * avg win) - (loss% * avg loss).
   */
  computeExpectancy(winRate: number, avgWin: number, avgLoss: number): number {
    return winRate * avgWin - (1 - winRate) * avgLoss;
  }

  /**
   * Compute all risk metrics from a time-series of daily PnL records.
   */
  computeAll(
    records: DailyPnlRecord[],
    currentEquity: number,
    riskFreeRateAnnual = 0.05,
    tradingDays = 252,
  ): RiskMetricsModel {
    const dailyReturns = records.map((r) => r.returnPercent);
    const equityCurve = records.map((r) => r.equity);
    if (currentEquity > 0) equityCurve.push(currentEquity);

    const { relative: maxDdRel, absolute: maxDdAbs } = this.computeMaxDrawdown(equityCurve);

    const grossProfit = records.filter((r) => r.netPnl > 0).reduce((s, r) => s + r.netPnl, 0);
    const grossLoss = records
      .filter((r) => r.netPnl < 0)
      .reduce((s, r) => s + Math.abs(r.netPnl), 0);
    const totalNetProfit = grossProfit - grossLoss;

    const wins = records.filter((r) => r.netPnl > 0);
    const losses = records.filter((r) => r.netPnl < 0);
    const winRate = records.length > 0 ? wins.length / records.length : 0;
    const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
    const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;

    const annualReturn = records.length > 0 ? this.mean(dailyReturns) * tradingDays : 0;

    return {
      sharpeRatio: this.computeSharpe(dailyReturns, riskFreeRateAnnual, tradingDays),
      sortinoRatio: this.computeSortino(dailyReturns, riskFreeRateAnnual, tradingDays),
      calmarRatio: this.computeCalmar(annualReturn, maxDdRel),
      maxDrawdown: maxDdRel,
      maxDrawdownAbsolute: maxDdAbs,
      rollingDrawdown: this.computeRollingDrawdown(equityCurve, 30),
      volatilityAnnualized: this.computeVolatility(dailyReturns, tradingDays),
      recoveryFactor: this.computeRecoveryFactor(totalNetProfit, maxDdAbs),
      profitFactor: this.computeProfitFactor(grossProfit, grossLoss),
      expectancy: this.computeExpectancy(winRate, avgWin, avgLoss),
      computedAt: Date.now(),
    };
  }

  private mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((s, v) => s + v, 0) / values.length;
  }

  private stddev(values: number[]): number {
    if (values.length < 2) return 0;
    const m = this.mean(values);
    const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
    return Math.sqrt(variance);
  }

  /** Compute period performance stats from a slice of daily records. */
  computePeriodStats(records: DailyPnlRecord[]): {
    returnAbsolute: number;
    returnPercent: number;
    winDays: number;
    lossDays: number;
    maxDrawdown: number;
    avgDailyReturn: number;
  } {
    if (records.length === 0) {
      return {
        returnAbsolute: 0,
        returnPercent: 0,
        winDays: 0,
        lossDays: 0,
        maxDrawdown: 0,
        avgDailyReturn: 0,
      };
    }
    const returnAbsolute = records.reduce((s, r) => s + r.netPnl, 0);
    const firstEquity = records[0].equity - records[0].netPnl;
    const returnPercent = firstEquity > 0 ? (returnAbsolute / firstEquity) * 100 : 0;
    const winDays = records.filter((r) => r.netPnl > 0).length;
    const lossDays = records.filter((r) => r.netPnl < 0).length;
    const { relative: maxDrawdown } = this.computeMaxDrawdown(records.map((r) => r.equity));
    const avgDailyReturn = this.mean(records.map((r) => r.returnPercent));
    return { returnAbsolute, returnPercent, winDays, lossDays, maxDrawdown, avgDailyReturn };
  }

  /** Slice daily records by number of trailing calendar days. */
  sliceByDays(records: DailyPnlRecord[], days: number): DailyPnlRecord[] {
    if (records.length === 0) return [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return records.filter((r) => r.date >= cutoffStr);
  }

  // Exposed for tests
  readonly _mean = this.mean.bind(this);
  readonly _stddev = this.stddev.bind(this);
  // Silence unused lint — SQRT_252 is available for future callers
  readonly _sqrt252 = SQRT_252;
}
