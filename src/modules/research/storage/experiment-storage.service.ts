import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { RedisClientService } from '@infrastructure/redis/redis-client.service';
import { RedisSortedSetService } from '@infrastructure/redis/sorted-set/redis-sorted-set.service';
import { Experiment } from '../domain/models/experiment.model';
import { ExperimentResult } from '../domain/models/experiment-result.model';
import { PromotionRecord } from '../domain/models/promotion-request.model';

/**
 * ExperimentStorageService persists research experiments and results in Redis.
 *
 * Storage layout:
 *   research:experiments          — Sorted Set; score = createdAt ms, member = experimentId
 *   research:experiment:{id}      — String; full JSON blob of Experiment
 *   research:result:{id}         — String; full JSON blob of ExperimentResult
 *   research:promotions:{id}     — List; JSON PromotionRecord entries (newest at index 0)
 *   research:name-idx:{hash}     — String; maps name hash → experimentId (duplicate guard)
 *
 * Retention: up to MAX_EXPERIMENTS (1000).  Oldest experiments are evicted on overflow.
 *
 * Design: every public method catches all errors and logs them without rethrowing.
 * Storage failures are non-fatal and must not crash the research sandbox.
 */
@Injectable()
export class ExperimentStorageService {
  private readonly context = ExperimentStorageService.name;

  private static readonly EXPERIMENTS_ZSET = 'research:experiments';
  private static readonly EXPERIMENT_PREFIX = 'research:experiment:';
  private static readonly RESULT_PREFIX = 'research:result:';
  private static readonly PROMOTIONS_PREFIX = 'research:promotions:';
  private static readonly NAME_IDX_PREFIX = 'research:name-idx:';
  private static readonly MAX_EXPERIMENTS = 1000;

  constructor(
    private readonly redis: RedisClientService,
    private readonly sortedSet: RedisSortedSetService,
    private readonly logger: AppLoggerService,
  ) {}

  // ── Write ─────────────────────────────────────────────────────────────────

  async saveExperiment(experiment: Experiment): Promise<void> {
    try {
      const client = this.redis.getClient();
      const key = ExperimentStorageService.EXPERIMENT_PREFIX + experiment.id;
      await client.set(key, JSON.stringify(experiment));

      await this.sortedSet.add(
        ExperimentStorageService.EXPERIMENTS_ZSET,
        experiment.createdAt.getTime(),
        experiment.id,
      );

      // name → id index for duplicate detection
      const nameKey = ExperimentStorageService.NAME_IDX_PREFIX + this.hashName(experiment.name);
      await client.set(nameKey, experiment.id);

      // evict oldest if over limit
      const trimCount = await this.sortedSet.trimToMaxSize(
        ExperimentStorageService.EXPERIMENTS_ZSET,
        ExperimentStorageService.MAX_EXPERIMENTS,
      );
      if (trimCount > 0) {
        this.logger.debug?.(
          `Research storage: evicted ${trimCount} old experiment(s)`,
          this.context,
        );
      }
    } catch (err) {
      this.logger.error(
        `Failed to save experiment ${experiment.id}`,
        (err as Error).stack,
        this.context,
      );
    }
  }

  async saveResult(result: ExperimentResult): Promise<void> {
    try {
      const client = this.redis.getClient();
      const key = ExperimentStorageService.RESULT_PREFIX + result.experimentId;
      await client.set(key, JSON.stringify(result));
    } catch (err) {
      this.logger.error(
        `Failed to save result for experiment ${result.experimentId}`,
        (err as Error).stack,
        this.context,
      );
    }
  }

  async appendPromotionRecord(experimentId: string, record: PromotionRecord): Promise<void> {
    try {
      const client = this.redis.getClient();
      const key = ExperimentStorageService.PROMOTIONS_PREFIX + experimentId;
      // LPUSH → newest at index 0
      await client.lpush(key, JSON.stringify(record));
    } catch (err) {
      this.logger.error(
        `Failed to append promotion record for experiment ${experimentId}`,
        (err as Error).stack,
        this.context,
      );
    }
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  async findById(experimentId: string): Promise<Experiment | null> {
    try {
      const client = this.redis.getClient();
      const key = ExperimentStorageService.EXPERIMENT_PREFIX + experimentId;
      const raw = await client.get(key);
      return raw ? (JSON.parse(raw) as Experiment) : null;
    } catch (err) {
      this.logger.error(
        `Failed to load experiment ${experimentId}`,
        (err as Error).stack,
        this.context,
      );
      return null;
    }
  }

  async findResultById(experimentId: string): Promise<ExperimentResult | null> {
    try {
      const client = this.redis.getClient();
      const key = ExperimentStorageService.RESULT_PREFIX + experimentId;
      const raw = await client.get(key);
      return raw ? (JSON.parse(raw) as ExperimentResult) : null;
    } catch (err) {
      this.logger.error(
        `Failed to load result for experiment ${experimentId}`,
        (err as Error).stack,
        this.context,
      );
      return null;
    }
  }

  /**
   * Returns the experiment id associated with the given name, or null.
   * Used to detect duplicate names on experiment creation.
   */
  async findIdByName(name: string): Promise<string | null> {
    try {
      const client = this.redis.getClient();
      const nameKey = ExperimentStorageService.NAME_IDX_PREFIX + this.hashName(name);
      return await client.get(nameKey);
    } catch (err) {
      this.logger.error(
        `Failed to lookup experiment by name: ${name}`,
        (err as Error).stack,
        this.context,
      );
      return null;
    }
  }

  /**
   * Returns experiments ordered newest-first.
   * @param offset  Number of newest experiments to skip.
   * @param limit   Maximum number of experiments to return.
   */
  async listAll(offset = 0, limit = 50): Promise<Experiment[]> {
    try {
      const total = await this.sortedSet.count(ExperimentStorageService.EXPERIMENTS_ZSET);
      if (total === 0) return [];

      // Newest first: zrevrangebyscore offset..limit
      const entries = await this.sortedSet.rangeByScoreReverse<string>(
        ExperimentStorageService.EXPERIMENTS_ZSET,
        '+inf',
        '-inf',
        limit + offset,
      );
      const page = entries.slice(offset, offset + limit);

      const experiments: Experiment[] = [];
      for (const entry of page) {
        const exp = await this.findById(entry.value);
        if (exp) experiments.push(exp);
      }
      return experiments;
    } catch (err) {
      this.logger.error('Failed to list experiments', (err as Error).stack, this.context);
      return [];
    }
  }

  async getPromotionHistory(experimentId: string): Promise<PromotionRecord[]> {
    try {
      const client = this.redis.getClient();
      const key = ExperimentStorageService.PROMOTIONS_PREFIX + experimentId;
      const raws = await client.lrange(key, 0, -1);
      return raws.map((r) => JSON.parse(r) as PromotionRecord);
    } catch (err) {
      this.logger.error(
        `Failed to load promotion history for experiment ${experimentId}`,
        (err as Error).stack,
        this.context,
      );
      return [];
    }
  }

  async countAll(): Promise<number> {
    try {
      return await this.sortedSet.count(ExperimentStorageService.EXPERIMENTS_ZSET);
    } catch {
      return 0;
    }
  }

  async deleteExperiment(experimentId: string): Promise<void> {
    try {
      const client = this.redis.getClient();
      await client.del(ExperimentStorageService.EXPERIMENT_PREFIX + experimentId);
      await client.del(ExperimentStorageService.RESULT_PREFIX + experimentId);
      await client.del(ExperimentStorageService.PROMOTIONS_PREFIX + experimentId);
      await client.zrem(ExperimentStorageService.EXPERIMENTS_ZSET, experimentId);
      // Note: the name-index entry is intentionally retained to prevent
      // immediate name reuse after deletion (soft tombstone).
    } catch (err) {
      this.logger.error(
        `Failed to delete experiment ${experimentId}`,
        (err as Error).stack,
        this.context,
      );
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * FNV-1a 32-bit hash of `name` → 8-char hex string.
   * Used to build a fixed-length Redis key segment from arbitrary names.
   */
  private hashName(name: string): string {
    let h = 2166136261;
    for (let i = 0; i < name.length; i++) {
      h ^= name.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }
}
