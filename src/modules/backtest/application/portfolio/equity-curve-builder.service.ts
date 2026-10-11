import { Injectable } from '@nestjs/common';
import { EquityCurvePoint } from '../../domain/models/equity-curve-point.model';

@Injectable()
export class EquityCurveBuilderService {
  private readonly points: EquityCurvePoint[] = [];
  private peakEquity = 0;

  initialize(initialCapital: number): void {
    this.points.length = 0;
    this.peakEquity = initialCapital;
  }

  record(timestamp: number, equity: number, cash: number, unrealizedPnl: number): void {
    if (equity > this.peakEquity) {
      this.peakEquity = equity;
    }

    const drawdown = this.peakEquity > 0 ? this.peakEquity - equity : 0;
    const drawdownPercent = this.peakEquity > 0 ? (drawdown / this.peakEquity) * 100 : 0;

    this.points.push({
      timestamp,
      equity,
      cash,
      unrealizedPnl,
      peakEquity: this.peakEquity,
      drawdown,
      drawdownPercent,
    });
  }

  getPoints(): EquityCurvePoint[] {
    return [...this.points];
  }

  getPeakEquity(): number {
    return this.peakEquity;
  }

  getCurrentDrawdownPercent(): number {
    const last = this.points[this.points.length - 1];
    return last?.drawdownPercent ?? 0;
  }

  length(): number {
    return this.points.length;
  }
}
