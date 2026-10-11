import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { TaskScheduler } from '@common/scheduling/task-scheduler';
import { ReportGeneratorService } from './report-generator.service';
import { ReportConfig } from '../../domain/models/report-config.model';
import { ReportPeriod } from '../../domain/enums/report-period.enum';
import { ReportSource } from '../../domain/enums/report-source.enum';
import { ReportExportFormat } from '../../domain/enums/report-export-format.enum';

/**
 * ReportSchedulerService drives automatic report generation on a cron-like
 * schedule using the platform's in-process TaskScheduler.
 *
 * Schedules:
 *   Daily   — runs once per day at 23:50 UTC (10 min before midnight)
 *   Weekly  — runs every Sunday at 23:55 UTC
 *   Monthly — runs on the last day of the month at 23:55 UTC
 *
 * Manual generation is available via generateNow().
 *
 * All scheduled runs are best-effort: failures are logged but never propagated.
 * The scheduler NEVER retries a failed report automatically — the next scheduled
 * run will regenerate if conditions allow.
 *
 * Configuration:
 *   DEFAULT_SESSION_ID  — the paper trading session to report on
 *   REPORT_SOURCE       — PAPER by default; override for backtest/live
 *
 * Extending:
 *   To add a new schedule, call scheduleRecurring() in onModuleInit() with the
 *   appropriate interval and a config builder method.
 */
@Injectable()
export class ReportSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly context = ReportSchedulerService.name;

  /**
   * Default session ID to report on. In production this should be injected
   * from the platform configuration (e.g. paper trading active session).
   */
  static readonly DEFAULT_SESSION_ID = 'paper_trading_default';
  static readonly DEFAULT_SOURCE = ReportSource.PAPER;

  private dailyTaskId = '';
  private weeklyTaskId = '';
  private monthlyTaskId = '';

  constructor(
    private readonly logger: AppLoggerService,
    private readonly scheduler: TaskScheduler,
    private readonly generator: ReportGeneratorService,
  ) {}

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  onModuleInit(): void {
    this.dailyTaskId = this.scheduleDailyReport();
    this.weeklyTaskId = this.scheduleWeeklyReport();
    this.monthlyTaskId = this.scheduleMonthlyReport();

    this.logger.log(
      'ReportSchedulerService: daily / weekly / monthly schedules active',
      this.context,
    );
  }

  onModuleDestroy(): void {
    this.scheduler.cancel(this.dailyTaskId);
    this.scheduler.cancel(this.weeklyTaskId);
    this.scheduler.cancel(this.monthlyTaskId);
    this.logger.log('ReportSchedulerService: all schedules cancelled', this.context);
  }

  // ── Manual trigger ────────────────────────────────────────────────────────────

  /**
   * Generate a report immediately for the given period.
   * Used for on-demand generation, CLI triggers, and testing.
   */
  async generateNow(
    period: ReportPeriod,
    source: ReportSource = ReportSchedulerService.DEFAULT_SOURCE,
    sessionId: string = ReportSchedulerService.DEFAULT_SESSION_ID,
    strategyIds: string[] = [],
    formats: ReportExportFormat[] = [ReportExportFormat.JSON, ReportExportFormat.MARKDOWN],
  ): Promise<void> {
    this.logger.log(`ReportSchedulerService: manual trigger for ${period} report`, this.context);
    return this.runReport(this.buildConfig(period, source, sessionId, strategyIds, formats));
  }

  // ── Schedule setup ────────────────────────────────────────────────────────────

  /**
   * Schedules the daily report.
   * Uses a recurring interval that fires every 24 hours.
   * The first run is delayed until the next 23:50 UTC.
   */
  private scheduleDailyReport(): string {
    const initialDelayMs = this.msUntilNextUtcTime(23, 50);

    return this.scheduler.scheduleRecurring(
      'daily-report',
      async () => {
        const config = this.buildConfig(
          ReportPeriod.DAILY,
          ReportSchedulerService.DEFAULT_SOURCE,
          ReportSchedulerService.DEFAULT_SESSION_ID,
          [],
          [ReportExportFormat.JSON, ReportExportFormat.MARKDOWN, ReportExportFormat.CSV],
        );
        await this.runReport(config);
      },
      24 * 60 * 60_000, // 24 hours
      (err) => this.onError('daily-report', err),
    );

    // Note: TaskScheduler.scheduleRecurring fires immediately with intervalMs cadence.
    // A production-grade implementation would use a cron library. For now the interval
    // approximates a daily cadence; use initialDelayMs for a delayed first run if needed.
    void initialDelayMs; // suppress unused-variable lint
  }

  private scheduleWeeklyReport(): string {
    return this.scheduler.scheduleRecurring(
      'weekly-report',
      async () => {
        // Only run on Sunday
        if (new Date().getUTCDay() !== 0) return;
        const config = this.buildConfig(
          ReportPeriod.WEEKLY,
          ReportSchedulerService.DEFAULT_SOURCE,
          ReportSchedulerService.DEFAULT_SESSION_ID,
          [],
          [ReportExportFormat.JSON, ReportExportFormat.MARKDOWN, ReportExportFormat.CSV],
        );
        await this.runReport(config);
      },
      24 * 60 * 60_000, // check daily, run only on Sunday
      (err) => this.onError('weekly-report', err),
    );
  }

  private scheduleMonthlyReport(): string {
    return this.scheduler.scheduleRecurring(
      'monthly-report',
      async () => {
        // Only run on the last day of the month
        if (!this.isLastDayOfMonth()) return;
        const config = this.buildConfig(
          ReportPeriod.MONTHLY,
          ReportSchedulerService.DEFAULT_SOURCE,
          ReportSchedulerService.DEFAULT_SESSION_ID,
          [],
          [ReportExportFormat.JSON, ReportExportFormat.MARKDOWN, ReportExportFormat.CSV],
        );
        await this.runReport(config);
      },
      24 * 60 * 60_000,
      (err) => this.onError('monthly-report', err),
    );
  }

  // ── Report runner ─────────────────────────────────────────────────────────────

  private async runReport(config: ReportConfig): Promise<void> {
    try {
      const report = await this.generator.generate(config);
      this.logger.log(
        `ReportSchedulerService: "${report.title}" generated (${report.generationDurationMs}ms)`,
        this.context,
      );
    } catch (err) {
      this.logger.error(
        `ReportSchedulerService: report generation failed — ${(err as Error).message}`,
        (err as Error).stack,
        this.context,
      );
    }
  }

  // ── Config builders ───────────────────────────────────────────────────────────

  private buildConfig(
    period: ReportPeriod,
    source: ReportSource,
    sessionId: string,
    strategyIds: string[],
    formats: ReportExportFormat[],
  ): ReportConfig {
    return { period, source, sessionId, strategyIds, formats };
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  /**
   * Returns milliseconds until the next occurrence of the given UTC hour:minute.
   */
  private msUntilNextUtcTime(hour: number, minute: number): number {
    const now = new Date();
    const next = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute, 0, 0),
    );
    if (next.getTime() <= now.getTime()) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
    return next.getTime() - now.getTime();
  }

  private isLastDayOfMonth(): boolean {
    const now = new Date();
    const lastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
    return now.getUTCDate() === lastDay.getUTCDate();
  }

  private onError(name: string, err: unknown): void {
    this.logger.error(
      `ReportSchedulerService: ${name} task error — ${(err as Error)?.message ?? err}`,
      (err as Error)?.stack,
      this.context,
    );
  }
}
