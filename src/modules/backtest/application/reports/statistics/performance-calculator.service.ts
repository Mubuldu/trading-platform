import { Injectable } from '@nestjs/common';
import { TradeRecord } from '../../../domain/models/trade-record.model';
import { EquityCurvePoint } from '../../../domain/models/equity-curve-point.model';

export interface CorePerformanceMetrics {
  readonly totalReturn: number;
  readonly totalReturnPercent: number;
  readonly annualizedReturnPercent: number;
  readonly totalTrades: number;
  readonly winningTrades: number;
  readonly losingTrades: number;
  readonly breakEvenTrades: number;
  readonly winRate: number;
  readonly profitFactor: number;
  readonly payoffRatio: number;
  readonly averageWin: number;
  readonly averageLoss: number;
  readonly averageWinPercent: number;
  readonly averageLossPercent: number;
  readonly largestWin: number;
  readonly largestLoss: number;
  readonly largestWinPercent: number;
  readonly largestLossPercent: number;
  readonly averageTradeDurationMs: number;
  readonly averagePositionSizeUsd: number;
}

const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;

@Injectable()
export class PerformanceCalculatorService {
  compute(
    initialCapital: number,
    finalEquity: number,
    trades: TradeRecord[],
    _equityCurve: EquityCurvePoint[],
    startTime: number,
    endTime: number,
  ): CorePerformanceMetrics {
    const totalReturn = finalEquity - initialCapital;
    const totalReturnPercent = initialCapital > 0 ? (totalReturn / initialCapital) * 100 : 0;

    const durationMs = endTime - startTime;
    const yearsElapsed = durationMs / MS_PER_YEAR;
    const annualizedReturnPercent =
      yearsElapsed > 0 ? (Math.pow(finalEquity / initialCapital, 1 / yearsElapsed) - 1) * 100 : 0;

    const winners = trades.filter((t) => t.netPnl > 0);
    const losers = trades.filter((t) => t.netPnl < 0);
    const breakEvens = trades.filter((t) => t.netPnl === 0);

    const winRate = trades.length > 0 ? winners.length / trades.length : 0;

    const grossWins = winners.reduce((s, t) => s + t.netPnl, 0);
    const grossLosses = Math.abs(losers.reduce((s, t) => s + t.netPnl, 0));
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

    const averageWin = winners.length > 0 ? grossWins / winners.length : 0;
    const averageLoss = losers.length > 0 ? grossLosses / losers.length : 0;
    const payoffRatio = averageLoss > 0 ? averageWin / averageLoss : averageWin > 0 ? Infinity : 0;

    const winPercents = winners.map((t) => (t.netPnl / (t.entryPrice * t.quantity)) * 100);
    const lossPercents = losers.map(
      (t) => (Math.abs(t.netPnl) / (t.entryPrice * t.quantity)) * 100,
    );

    const averageWinPercent =
      winPercents.length > 0 ? winPercents.reduce((s, p) => s + p, 0) / winPercents.length : 0;
    const averageLossPercent =
      lossPercents.length > 0 ? lossPercents.reduce((s, p) => s + p, 0) / lossPercents.length : 0;

    const largestWin = winners.length > 0 ? Math.max(...winners.map((t) => t.netPnl)) : 0;
    const largestLoss = losers.length > 0 ? Math.max(...losers.map((t) => Math.abs(t.netPnl))) : 0;
    const largestWinPercent = winPercents.length > 0 ? Math.max(...winPercents) : 0;
    const largestLossPercent = lossPercents.length > 0 ? Math.max(...lossPercents) : 0;

    const averageTradeDurationMs =
      trades.length > 0 ? trades.reduce((s, t) => s + t.durationMs, 0) / trades.length : 0;

    const positionSizes = trades.map((t) => t.entryPrice * t.quantity);
    const averagePositionSizeUsd =
      positionSizes.length > 0
        ? positionSizes.reduce((s, p) => s + p, 0) / positionSizes.length
        : 0;

    return {
      totalReturn,
      totalReturnPercent,
      annualizedReturnPercent,
      totalTrades: trades.length,
      winningTrades: winners.length,
      losingTrades: losers.length,
      breakEvenTrades: breakEvens.length,
      winRate,
      profitFactor,
      payoffRatio,
      averageWin,
      averageLoss,
      averageWinPercent,
      averageLossPercent,
      largestWin,
      largestLoss,
      largestWinPercent,
      largestLossPercent,
      averageTradeDurationMs,
      averagePositionSizeUsd,
    };
  }
}
