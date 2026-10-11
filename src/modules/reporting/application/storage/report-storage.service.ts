import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { RedisClientService } from '@infrastructure/redis/redis-client.service';
import { RedisSortedSetService } from '@infrastructure/redis/sorted-set/redis-sorted-set.service';
import { TradingReport, ReportSummary } from '../../domain/models/report.model';
import { ReportConfig } from '../../domain/models/report-config.model';

/**
 * ReportStorageService persists and retrieves TradingReport objects using Redis.
 *
 * Storage layout:
 *   reports:all          — Sorted Set; score = generatedAt (unix ms), member = reportId
 *   reports:report:{id}  — String; full JSON blob of the latest version of a report
 *   reports:versions:{id}:{v} — String; full JSON blob of a specific version
 *   reports:index        — List of ReportSummary JSON (newest first)
 *
 * Versioning:
 *   Each reportId has a monotonically increasing version counter.
 *   A unique reportId is derived from the period+source+sessionId combination so
 *   re-generation of the same report increments the version rather than creating
 *   a new entry in the index.
 *
 * Retention: up to MAX_REPORTS (365) full reports are kept; oldest are evicted.
 *
 * Design: every public method catches all errors and logs them.
 * Storage failures must NEVER propagate and crash the platform.
 */
@Injectable()
export class ReportStorageService {
  private readonly context = ReportStorageService.name;

  private static readonly ALL_ZSET = 'reports:all';
  private static readonly REPORT_PREFIX = 'reports:report:';
  private static readonly VER_PREFIX = 'reports:versions:';
  private static readonly INDEX_KEY = 'reports:index';
  private static readonly VER_CTR_PREFIX = 'reports:version-counter:';
  private static readonly MAX_REPORTS = 365;

  constructor(
    private readonly redis: RedisClientService,
    private readonly sortedSet: RedisSortedSetService,
    private readonly logger: AppLoggerService,
  ) {}

  // ── Write ─────────────────────────────────────────────────────────────────────

  async save(report: TradingReport): Promise<void> {
    try {
      const client = this.redis.getClient();
      const json = JSON.stringify(report);

      // 1. Store full report (latest version)
      await client.set(ReportStorageService.REPORT_PREFIX + report.reportId, json);

      // 2. Store versioned snapshot
      const verKey = `${ReportStorageService.VER_PREFIX}${report.reportId}:${report.version}`;
      await client.set(verKey, json);

      // 3. Register in sorted set
      await this.sortedSet.add(ReportStorageService.ALL_ZSET, report.generatedAt, report.reportId);

      // 4. Trim to retention limit
      const trimmed = await this.sortedSet.trimToMaxSize(
        ReportStorageService.ALL_ZSET,
        ReportStorageService.MAX_REPORTS,
      );
      if (trimmed > 0) {
        this.logger.debug?.(`Report storage: evicted ${trimmed} old report(s)`, this.context);
      }

      // 5. Update lightweight index (newest first)
      const summary = this.toSummary(report);
      await client.lpush(ReportStorageService.INDEX_KEY, JSON.stringify(summary));
      await client.ltrim(ReportStorageService.INDEX_KEY, 0, ReportStorageService.MAX_REPORTS - 1);
    } catch (err) {
      this.logger.error(
        `Report storage: save failed for ${report.reportId} — ${(err as Error).message}`,
        (err as Error).stack,
        this.context,
      );
      // Do not rethrow — storage failures are logged, not propagated
    }
  }

  // ── Read ──────────────────────────────────────────────────────────────────────

  async loadById(reportId: string): Promise<TradingReport | null> {
    try {
      const client = this.redis.getClient();
      const raw = await client.get(ReportStorageService.REPORT_PREFIX + reportId);
      return raw ? (JSON.parse(raw) as TradingReport) : null;
    } catch (err) {
      this.logger.error('Report storage: loadById failed', (err as Error).stack, this.context);
      return null;
    }
  }

  async loadVersion(reportId: string, version: number): Promise<TradingReport | null> {
    try {
      const client = this.redis.getClient();
      const key = `${ReportStorageService.VER_PREFIX}${reportId}:${version}`;
      const raw = await client.get(key);
      return raw ? (JSON.parse(raw) as TradingReport) : null;
    } catch (err) {
      this.logger.error('Report storage: loadVersion failed', (err as Error).stack, this.context);
      return null;
    }
  }

  async loadLatest(limit = 20): Promise<TradingReport[]> {
    try {
      const entries = await this.sortedSet.getLatest<string>(ReportStorageService.ALL_ZSET, limit);
      const reports = await Promise.all(entries.map((e) => this.loadById(e.value)));
      return reports.filter((r): r is TradingReport => r !== null);
    } catch (err) {
      this.logger.error('Report storage: loadLatest failed', (err as Error).stack, this.context);
      return [];
    }
  }

  async loadByRange(fromMs: number, toMs: number): Promise<TradingReport[]> {
    try {
      const entries = await this.sortedSet.rangeByScore<string>(
        ReportStorageService.ALL_ZSET,
        fromMs,
        toMs,
      );
      const reports = await Promise.all(entries.map((e) => this.loadById(e.value)));
      return reports
        .filter((r): r is TradingReport => r !== null)
        .sort((a, b) => b.generatedAt - a.generatedAt);
    } catch (err) {
      this.logger.error('Report storage: loadByRange failed', (err as Error).stack, this.context);
      return [];
    }
  }

  async loadIndex(limit = 100): Promise<ReportSummary[]> {
    try {
      const client = this.redis.getClient();
      const raws = await client.lrange(ReportStorageService.INDEX_KEY, 0, limit - 1);
      return raws.map((r) => JSON.parse(r) as ReportSummary);
    } catch (err) {
      this.logger.error('Report storage: loadIndex failed', (err as Error).stack, this.context);
      return [];
    }
  }

  async countReports(): Promise<number> {
    try {
      return this.sortedSet.count(ReportStorageService.ALL_ZSET);
    } catch {
      return 0;
    }
  }

  // ── Versioning ────────────────────────────────────────────────────────────────

  /**
   * Determines the stable reportId for this config and increments the version
   * counter. Returns { reportId, version } for the next generation.
   *
   * reportId is derived deterministically from period + source + sessionId + strategyIds
   * so that re-running a report for the same period produces a new version, not a new ID.
   */
  async nextVersion(config: ReportConfig): Promise<{ reportId: string; version: number }> {
    const reportId = this.stableReportId(config);
    try {
      const client = this.redis.getClient();
      const ctrKey = ReportStorageService.VER_CTR_PREFIX + reportId;
      const version = await client.incr(ctrKey);
      return { reportId, version };
    } catch (err) {
      this.logger.error('Report storage: nextVersion failed', (err as Error).stack, this.context);
      // Fall back to version 1 if counter fails (storage fault tolerance)
      return { reportId, version: 1 };
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  /**
   * Stable deterministic ID derived from report classification.
   * The same period + source + session always maps to the same reportId.
   * Using a simple hash avoids UUIDs for the base ID so versions are linked.
   */
  private stableReportId(config: ReportConfig): string {
    const components = [
      config.period,
      config.source,
      config.sessionId,
      ...(config.strategyIds ?? []).sort(),
      config.referenceDate ?? '',
      config.fromMs !== undefined ? String(config.fromMs) : '',
      config.toMs !== undefined ? String(config.toMs) : '',
    ];
    return `rpt_${this.simpleHash(components.join('|'))}`;
  }

  /** djb2 hash truncated to 12 hex chars. */
  private simpleHash(str: string): string {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
      hash >>>= 0; // keep as 32-bit unsigned
    }
    return hash.toString(16).padStart(8, '0');
  }

  private toSummary(report: TradingReport): ReportSummary {
    return {
      reportId: report.reportId,
      version: report.version,
      generatedAt: report.generatedAt,
      title: report.title,
      period: report.period,
      source: report.source,
      sessionId: report.sessionId,
      strategyIds: report.strategyIds,
      periodStartDate: report.periodStartDate,
      periodEndDate: report.periodEndDate,
      status: report.status,
      netProfit: report.executiveSummary.netPnl,
      totalReturnPercent: report.executiveSummary.totalReturnPercent,
      sharpeRatio: report.executiveSummary.sharpeRatio,
      maxDrawdownPercent: report.executiveSummary.maxDrawdownPercent,
      totalTrades: report.executiveSummary.totalTrades,
    };
  }
}
