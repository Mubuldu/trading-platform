export interface DailyPnlRecord {
  readonly date: string;
  readonly realizedPnl: number;
  readonly unrealizedPnl: number;
  readonly fees: number;
  readonly netPnl: number;
  readonly equity: number;
  readonly returnPercent: number;
}

export interface PeriodPerformance {
  readonly returnAbsolute: number;
  readonly returnPercent: number;
  readonly winDays: number;
  readonly lossDays: number;
  readonly maxDrawdown: number;
  readonly avgDailyReturn: number;
}

export interface PerformanceModel {
  readonly daily: PeriodPerformance;
  readonly weekly: PeriodPerformance;
  readonly monthly: PeriodPerformance;
  readonly yearly: PeriodPerformance;
  readonly lifetime: PeriodPerformance;
  readonly computedAt: number;
}
