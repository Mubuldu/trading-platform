import { Injectable } from '@nestjs/common';
import { EquityCurvePoint } from '../../../domain/models/equity-curve-point.model';
import { DrawdownPeriod } from '../../../domain/models/performance-report.model';

export interface DrawdownStats {
  readonly maxDrawdownPercent: number;
  readonly maxDrawdownDurationMs: number;
  readonly longestDrawdownDurationMs: number;
  readonly maxDrawdownPeriod?: DrawdownPeriod;
  readonly longestDrawdownPeriod?: DrawdownPeriod;
  readonly allDrawdownPeriods: DrawdownPeriod[];
}

@Injectable()
export class DrawdownCalculatorService {
  compute(equityCurve: EquityCurvePoint[]): DrawdownStats {
    if (equityCurve.length === 0) {
      return {
        maxDrawdownPercent: 0,
        maxDrawdownDurationMs: 0,
        longestDrawdownDurationMs: 0,
        allDrawdownPeriods: [],
      };
    }

    const periods: DrawdownPeriod[] = [];
    let peakTime = equityCurve[0].timestamp;
    let peakEquity = equityCurve[0].equity;
    let inDrawdown = false;
    let drawdownStartTime = 0;
    let troughTime = 0;
    let troughEquity = peakEquity;

    for (const point of equityCurve) {
      if (point.equity >= peakEquity) {
        if (inDrawdown) {
          const drawdownPercent = ((peakEquity - troughEquity) / peakEquity) * 100;
          const recoveryDurationMs = point.timestamp - troughTime;

          periods.push({
            peakTime: drawdownStartTime,
            troughTime,
            recoveryTime: point.timestamp,
            drawdownPercent,
            durationMs: troughTime - drawdownStartTime,
            recoveryDurationMs,
          });

          inDrawdown = false;
        }
        peakEquity = point.equity;
        peakTime = point.timestamp;
        troughEquity = point.equity;
        troughTime = point.timestamp;
      } else {
        if (!inDrawdown) {
          inDrawdown = true;
          drawdownStartTime = peakTime;
        }
        if (point.equity < troughEquity) {
          troughEquity = point.equity;
          troughTime = point.timestamp;
        }
      }
    }

    if (inDrawdown) {
      const drawdownPercent = ((peakEquity - troughEquity) / peakEquity) * 100;
      periods.push({
        peakTime: drawdownStartTime,
        troughTime,
        drawdownPercent,
        durationMs: troughTime - drawdownStartTime,
      });
    }

    const maxDrawdownPeriod = periods.reduce<DrawdownPeriod | undefined>(
      (best, p) => (!best || p.drawdownPercent > best.drawdownPercent ? p : best),
      undefined,
    );

    const longestDrawdownPeriod = periods.reduce<DrawdownPeriod | undefined>((best, p) => {
      const pTotal = p.durationMs + (p.recoveryDurationMs ?? 0);
      const bTotal = best ? best.durationMs + (best.recoveryDurationMs ?? 0) : 0;
      return pTotal > bTotal ? p : best;
    }, undefined);

    return {
      maxDrawdownPercent: maxDrawdownPeriod?.drawdownPercent ?? 0,
      maxDrawdownDurationMs: maxDrawdownPeriod?.durationMs ?? 0,
      longestDrawdownDurationMs: longestDrawdownPeriod
        ? longestDrawdownPeriod.durationMs + (longestDrawdownPeriod.recoveryDurationMs ?? 0)
        : 0,
      maxDrawdownPeriod,
      longestDrawdownPeriod,
      allDrawdownPeriods: periods,
    };
  }
}
