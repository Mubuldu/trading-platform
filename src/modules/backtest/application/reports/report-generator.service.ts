import { Injectable } from '@nestjs/common';
import { BacktestConfig } from '../../domain/models/backtest-config.model';
import { PerformanceReport } from '../../domain/models/performance-report.model';
import { TradeRecord } from '../../domain/models/trade-record.model';
import { BacktestOrder } from '../../domain/models/backtest-order.model';
import { EquityCurvePoint } from '../../domain/models/equity-curve-point.model';
import { PerformanceCalculatorService } from './statistics/performance-calculator.service';
import { DrawdownCalculatorService } from './statistics/drawdown-calculator.service';
import { RiskMetricsCalculatorService } from './statistics/risk-metrics-calculator.service';

@Injectable()
export class ReportGeneratorService {
  constructor(
    private readonly performanceCalc: PerformanceCalculatorService,
    private readonly drawdownCalc: DrawdownCalculatorService,
    private readonly riskMetricsCalc: RiskMetricsCalculatorService,
  ) {}

  generate(
    config: BacktestConfig,
    initialCapital: number,
    finalEquity: number,
    trades: TradeRecord[],
    orders: BacktestOrder[],
    equityCurve: EquityCurvePoint[],
    candlesProcessed: number,
    totalCommission: number,
    totalSlippage: number,
  ): PerformanceReport {
    const core = this.performanceCalc.compute(
      initialCapital,
      finalEquity,
      trades,
      equityCurve,
      config.startTime,
      config.endTime,
    );

    const drawdown = this.drawdownCalc.compute(equityCurve);

    const riskMetrics = this.riskMetricsCalc.compute(
      equityCurve,
      trades,
      core.annualizedReturnPercent,
      drawdown.maxDrawdownPercent,
    );

    return {
      sessionId: config.sessionId,
      symbol: config.symbol,
      exchange: config.exchange,
      timeframe: config.timeframe,
      startTime: config.startTime,
      endTime: config.endTime,
      candlesProcessed,

      initialCapital,
      finalEquity,

      totalReturn: core.totalReturn,
      totalReturnPercent: core.totalReturnPercent,
      annualizedReturnPercent: core.annualizedReturnPercent,

      sharpeRatio: riskMetrics.sharpeRatio,
      sortinoRatio: riskMetrics.sortinoRatio,
      calmarRatio: riskMetrics.calmarRatio,

      maxDrawdownPercent: drawdown.maxDrawdownPercent,
      maxDrawdownDurationMs: drawdown.maxDrawdownDurationMs,
      maxDrawdownPeriod: drawdown.maxDrawdownPeriod,
      longestDrawdownPeriod: drawdown.longestDrawdownPeriod,

      totalTrades: core.totalTrades,
      winningTrades: core.winningTrades,
      losingTrades: core.losingTrades,
      breakEvenTrades: core.breakEvenTrades,
      winRate: core.winRate,

      profitFactor: core.profitFactor,
      payoffRatio: core.payoffRatio,

      averageWin: core.averageWin,
      averageLoss: core.averageLoss,
      averageWinPercent: core.averageWinPercent,
      averageLossPercent: core.averageLossPercent,
      largestWin: core.largestWin,
      largestLoss: core.largestLoss,
      largestWinPercent: core.largestWinPercent,
      largestLossPercent: core.largestLossPercent,

      averageTradeDurationMs: core.averageTradeDurationMs,
      maxConsecutiveWins: riskMetrics.maxConsecutiveWins,
      maxConsecutiveLosses: riskMetrics.maxConsecutiveLosses,

      totalCommission,
      totalSlippage,

      averagePositionSizeUsd: core.averagePositionSizeUsd,
      averageMaePercent: riskMetrics.averageMaePercent,
      averageMfePercent: riskMetrics.averageMfePercent,

      equityCurve,
      trades,
      orders,
    };
  }
}
