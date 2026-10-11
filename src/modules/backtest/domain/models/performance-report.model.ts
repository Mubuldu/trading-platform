import { Timeframe } from '@modules/indicator/domain/enums/timeframe.enum';
import { EquityCurvePoint } from './equity-curve-point.model';
import { TradeRecord } from './trade-record.model';
import { BacktestOrder } from './backtest-order.model';

export interface DrawdownPeriod {
  readonly peakTime: number;
  readonly troughTime: number;
  readonly recoveryTime?: number;
  readonly drawdownPercent: number;
  readonly durationMs: number;
  readonly recoveryDurationMs?: number;
}

export interface PerformanceReport {
  readonly sessionId: string;
  readonly symbol: string;
  readonly exchange: string;
  readonly timeframe: Timeframe;
  readonly startTime: number;
  readonly endTime: number;
  readonly candlesProcessed: number;

  readonly initialCapital: number;
  readonly finalEquity: number;

  readonly totalReturn: number;
  readonly totalReturnPercent: number;
  readonly annualizedReturnPercent: number;

  readonly sharpeRatio: number;
  readonly sortinoRatio: number;
  readonly calmarRatio: number;

  readonly maxDrawdownPercent: number;
  readonly maxDrawdownDurationMs: number;
  readonly maxDrawdownPeriod?: DrawdownPeriod;
  readonly longestDrawdownPeriod?: DrawdownPeriod;

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
  readonly maxConsecutiveWins: number;
  readonly maxConsecutiveLosses: number;

  readonly totalCommission: number;
  readonly totalSlippage: number;

  readonly averagePositionSizeUsd: number;
  readonly averageMaePercent: number;
  readonly averageMfePercent: number;

  readonly equityCurve: EquityCurvePoint[];
  readonly trades: TradeRecord[];
  readonly orders: BacktestOrder[];
}
