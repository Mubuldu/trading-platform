import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { RedisClientService } from '@infrastructure/redis/redis-client.service';
import { RedisSortedSetService } from '@infrastructure/redis/sorted-set/redis-sorted-set.service';
import {
  AnalyticsSnapshot,
  AnalyticsSnapshotSummary,
} from '../domain/models/analytics-snapshot.model';
import { AnalyticsStorageError } from '../domain/errors/analytics.errors';

/**
 * AnalyticsStorageService persists and retrieves analytics snapshots using Redis.
 *
 * Storage layout:
 *   analytics:snapshots        — Sorted Set; score = computedAt (unix ms), member = snapshotId
 *   analytics:snapshot:{id}    — String; full JSON blob of the AnalyticsSnapshot
 *   analytics:index            — List of AnalyticsSnapshotSummary JSON (newest first)
 *
 * Retention: up to MAX_SNAPSHOTS (500) full snapshots are kept.
 * Oldest snapshots are evicted when the limit is exceeded.
 *
 * Design principle: every public method catches all errors and logs them.
 * Analytics storage failures must NEVER propagate and crash the platform.
 */
@Injectable()
export class AnalyticsStorageService {
  private readonly context = AnalyticsStorageService.name;

  private static readonly SNAPSHOTS_ZSET = 'analytics:snapshots';
  private static readonly SNAPSHOT_PREFIX = 'analytics:snapshot:';
  private static readonly INDEX_KEY = 'analytics:index';
  private static readonly MAX_SNAPSHOTS = 500;

  constructor(
    private readonly redis: RedisClientService,
    private readonly sortedSet: RedisSortedSetService,
    private readonly logger: AppLoggerService,
  ) {}

  // ── Write ────────────────────────────────────────────────────────────────────

  async saveSnapshot(snapshot: AnalyticsSnapshot): Promise<void> {
    try {
      const client = this.redis.getClient();

      // 1. Store full snapshot
      const key = AnalyticsStorageService.SNAPSHOT_PREFIX + snapshot.snapshotId;
      await client.set(key, JSON.stringify(snapshot));

      // 2. Register in sorted set (score = timestamp for range queries)
      await this.sortedSet.add(
        AnalyticsStorageService.SNAPSHOTS_ZSET,
        snapshot.computedAt,
        snapshot.snapshotId,
      );

      // 3. Trim to retention limit (evict oldest)
      const trimCount = await this.sortedSet.trimToMaxSize(
        AnalyticsStorageService.SNAPSHOTS_ZSET,
        AnalyticsStorageService.MAX_SNAPSHOTS,
      );
      if (trimCount > 0) {
        this.logger.debug?.(
          `Analytics storage: evicted ${trimCount} old snapshot(s)`,
          this.context,
        );
      }

      // 4. Update lightweight index
      const summary = this.toSummary(snapshot);
      await client.lpush(AnalyticsStorageService.INDEX_KEY, JSON.stringify(summary));
      await client.ltrim(
        AnalyticsStorageService.INDEX_KEY,
        0,
        AnalyticsStorageService.MAX_SNAPSHOTS - 1,
      );
    } catch (err) {
      const error = new AnalyticsStorageError('saveSnapshot', err as Error);
      this.logger.error(error.message, (err as Error).stack, this.context);
      // Do not rethrow — storage failure must not crash analytics
    }
  }

  // ── Read ─────────────────────────────────────────────────────────────────────

  async loadLatestSnapshot(): Promise<AnalyticsSnapshot | null> {
    try {
      const entries = await this.sortedSet.getLatest<string>(
        AnalyticsStorageService.SNAPSHOTS_ZSET,
        1,
      );
      if (entries.length === 0) return null;
      const id = entries[0]!.value;
      return this.loadById(id);
    } catch (err) {
      this.logger.error(
        'Analytics: failed to load latest snapshot',
        (err as Error).stack,
        this.context,
      );
      return null;
    }
  }

  async loadSnapshots(limit = 100): Promise<AnalyticsSnapshot[]> {
    try {
      const entries = await this.sortedSet.getLatest<string>(
        AnalyticsStorageService.SNAPSHOTS_ZSET,
        limit,
      );
      const snapshots = await Promise.all(entries.map((e) => this.loadById(e.value)));
      return snapshots.filter((s): s is AnalyticsSnapshot => s !== null);
    } catch (err) {
      this.logger.error('Analytics: failed to load snapshots', (err as Error).stack, this.context);
      return [];
    }
  }

  async loadSnapshotsByRange(fromMs: number, toMs: number): Promise<AnalyticsSnapshot[]> {
    try {
      const entries = await this.sortedSet.rangeByScore<string>(
        AnalyticsStorageService.SNAPSHOTS_ZSET,
        fromMs,
        toMs,
      );
      const snapshots = await Promise.all(entries.map((e) => this.loadById(e.value)));
      return snapshots
        .filter((s): s is AnalyticsSnapshot => s !== null)
        .sort((a, b) => b.computedAt - a.computedAt);
    } catch (err) {
      this.logger.error(
        'Analytics: failed to load snapshots by range',
        (err as Error).stack,
        this.context,
      );
      return [];
    }
  }

  async loadSummaries(limit = 100): Promise<AnalyticsSnapshotSummary[]> {
    try {
      const client = this.redis.getClient();
      const raws = await client.lrange(AnalyticsStorageService.INDEX_KEY, 0, limit - 1);
      return raws.map((r) => JSON.parse(r) as AnalyticsSnapshotSummary);
    } catch (err) {
      this.logger.error('Analytics: failed to load index', (err as Error).stack, this.context);
      return [];
    }
  }

  async countSnapshots(): Promise<number> {
    try {
      return this.sortedSet.count(AnalyticsStorageService.SNAPSHOTS_ZSET);
    } catch {
      return 0;
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async loadById(id: string): Promise<AnalyticsSnapshot | null> {
    const client = this.redis.getClient();
    const raw = await client.get(AnalyticsStorageService.SNAPSHOT_PREFIX + id);
    return raw ? (JSON.parse(raw) as AnalyticsSnapshot) : null;
  }

  private toSummary(snapshot: AnalyticsSnapshot): AnalyticsSnapshotSummary {
    return {
      snapshotId: snapshot.snapshotId,
      sessionId: snapshot.sessionId,
      strategyId: snapshot.strategyId,
      computedAt: snapshot.computedAt,
      netProfit: snapshot.performance.netProfit,
      totalReturnPercent: snapshot.performance.totalReturnPercent,
      sharpeRatio: snapshot.riskMetrics.sharpeRatio,
      maxDrawdown: snapshot.riskMetrics.maxDrawdown,
      totalTrades: snapshot.performance.totalTrades,
    };
  }
}
