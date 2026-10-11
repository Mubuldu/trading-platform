import { Injectable } from '@nestjs/common';
import { CapitalMetrics, CapitalCurvePoint } from '../../domain/models/capital-metrics.model';

/** Input shape consumed by the calculator — decoupled from paper trading types. */
export interface DailyCapitalRecord {
  readonly date: string; // YYYY-MM-DD
  readonly timestamp: number; // unix ms
  readonly equity: number;
  readonly cashBalance: number;
  readonly unrealizedPnl: number;
}

/**
 * CapitalMetricsCalculator builds equity and balance curves from daily records
 * and computes capital utilisation metrics.
 *
 * Input requirements:
 *   dailyRecords  — chronologically ordered, one per trading day
 *   currentEquity — live equity (may differ from last daily close)
 *   currentBalance— live cash balance
 *   grossExposure — total notional across all open positions (for leverage calc)
 */
@Injectable()
export class CapitalMetricsCalculator {
  compute(
    dailyRecords: DailyCapitalRecord[],
    currentEquity: number,
    currentBalance: number,
    initialCapital: number,
    grossExposure = 0,
    marginUsed = 0,
  ): CapitalMetrics {
    const sorted = [...dailyRecords].sort((a, b) => a.timestamp - b.timestamp);

    // Build equity/balance curves with daily returns and cumulative returns
    const equityCurve: CapitalCurvePoint[] = [];
    const balanceCurve: CapitalCurvePoint[] = [];
    let peak = initialCapital;
    let startEquity = sorted.length > 0 ? sorted[0]!.equity : currentEquity;
    if (startEquity <= 0) startEquity = initialCapital;

    for (let i = 0; i < sorted.length; i++) {
      const rec = sorted[i]!;
      const prev = i > 0 ? sorted[i - 1]!.equity : initialCapital;
      const dailyReturn = prev > 0 ? (rec.equity - prev) / prev : 0;
      const cumulativeReturn = startEquity > 0 ? (rec.equity - startEquity) / startEquity : 0;

      if (rec.equity > peak) peak = rec.equity;
      const drawdownPercent = peak > 0 ? (peak - rec.equity) / peak : 0;

      const point: CapitalCurvePoint = {
        date: rec.date,
        timestamp: rec.timestamp,
        equity: rec.equity,
        cashBalance: rec.cashBalance,
        unrealizedPnl: rec.unrealizedPnl,
        dailyReturn,
        cumulativeReturn,
        drawdownPercent,
      };

      equityCurve.push(point);
      balanceCurve.push({ ...point, equity: rec.cashBalance });
    }

    const buyingPower = Math.max(currentBalance - marginUsed, 0);
    const marginUtilizationPercent = currentEquity > 0 ? marginUsed / currentEquity : 0;
    const leverageUtilization = currentEquity > 0 ? grossExposure / currentEquity : 0;
    const cashUtilizationPercent =
      currentEquity > 0 ? (currentEquity - currentBalance) / currentEquity : 0;

    return {
      equityCurve,
      balanceCurve,
      currentEquity,
      currentBalance,
      buyingPower,
      marginUsed,
      marginUtilizationPercent,
      leverageUtilization,
      cashUtilizationPercent: Math.min(1, Math.max(0, cashUtilizationPercent)),
      snapshotAt: Date.now(),
    };
  }
}
