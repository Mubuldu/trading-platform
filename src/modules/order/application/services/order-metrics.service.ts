import { Injectable } from '@nestjs/common';

@Injectable()
export class OrderMetricsService {
  private created = 0;
  private filled = 0;
  private cancelled = 0;
  private rejected = 0;
  private expired = 0;
  private failed = 0;
  private fillTimeSamples: number[] = [];

  recordCreated(): void {
    this.created++;
  }

  recordFilled(fillTimeMs: number): void {
    this.filled++;
    this.fillTimeSamples.push(fillTimeMs);
    if (this.fillTimeSamples.length > 1000) {
      this.fillTimeSamples.shift();
    }
  }

  recordCancelled(): void {
    this.cancelled++;
  }

  recordRejected(): void {
    this.rejected++;
  }

  recordExpired(): void {
    this.expired++;
  }

  recordFailed(): void {
    this.failed++;
  }

  snapshot(): OrderMetricsSnapshot {
    const terminal = this.filled + this.cancelled + this.rejected + this.expired + this.failed;
    return {
      totalCreated: this.created,
      totalFilled: this.filled,
      totalCancelled: this.cancelled,
      totalRejected: this.rejected,
      totalExpired: this.expired,
      totalFailed: this.failed,
      fillRatio: terminal > 0 ? this.filled / terminal : 0,
      cancelRatio: terminal > 0 ? this.cancelled / terminal : 0,
      averageFillTimeMs: this.avgFillTime(),
    };
  }

  private avgFillTime(): number {
    if (this.fillTimeSamples.length === 0) return 0;
    const sum = this.fillTimeSamples.reduce((a, b) => a + b, 0);
    return sum / this.fillTimeSamples.length;
  }
}

export interface OrderMetricsSnapshot {
  totalCreated: number;
  totalFilled: number;
  totalCancelled: number;
  totalRejected: number;
  totalExpired: number;
  totalFailed: number;
  fillRatio: number;
  cancelRatio: number;
  averageFillTimeMs: number;
}
