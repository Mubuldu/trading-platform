import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { RedisClientService } from '@infrastructure/redis/redis-client.service';
import { BacktestResult } from '../../domain/models/backtest-result.model';

const REDIS_KEY = 'backtest:results';
const MAX_HISTORY = 20;

/**
 * BacktestHistoryService persists BacktestResult snapshots in a Redis list so
 * the dashboard can display past runs without re-executing the simulation.
 *
 * Storage layout:
 *   Key:   {keyPrefix}backtest:results   (ioredis adds the global key prefix)
 *   Type:  Redis list — newest entry at index 0 (LPUSH)
 *   Size:  Trimmed to MAX_HISTORY (20) after every push
 *
 * Each element is a JSON-serialised BacktestResult. The full report including
 * equity curve and individual trades is stored so the caller receives a
 * complete snapshot.
 */
@Injectable()
export class BacktestHistoryService {
  private readonly context = BacktestHistoryService.name;

  constructor(
    private readonly redis: RedisClientService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * Push a completed result to the front of the history list, then trim the
   * list to MAX_HISTORY entries. LPUSH + LTRIM is atomic enough for this use
   * case — ordering is best-effort and duplicates on crash-recovery are acceptable.
   */
  async saveResult(result: BacktestResult): Promise<void> {
    const client = this.redis.getClient();
    const payload = JSON.stringify(result);

    try {
      await client.lpush(REDIS_KEY, payload);
      await client.ltrim(REDIS_KEY, 0, MAX_HISTORY - 1);
      this.logger.log(
        `Saved backtest result ${result.sessionId} to history (max ${MAX_HISTORY})`,
        this.context,
      );
    } catch (e) {
      // History persistence is non-fatal; the result was already returned to the caller.
      this.logger.warn(
        `Failed to save backtest result to Redis: ${(e as Error).message}`,
        this.context,
      );
    }
  }

  /**
   * Return the most-recent `limit` results (newest first).
   * Returns an empty array when Redis is unavailable or the key does not exist.
   */
  async getHistory(limit: number = MAX_HISTORY): Promise<BacktestResult[]> {
    const client = this.redis.getClient();
    const clampedLimit = Math.min(Math.max(limit, 1), MAX_HISTORY);

    try {
      const entries = await client.lrange(REDIS_KEY, 0, clampedLimit - 1);
      return entries
        .map((entry) => {
          try {
            return JSON.parse(entry) as BacktestResult;
          } catch {
            return null;
          }
        })
        .filter((r): r is BacktestResult => r !== null);
    } catch (e) {
      this.logger.warn(
        `Failed to read backtest history from Redis: ${(e as Error).message}`,
        this.context,
      );
      return [];
    }
  }

  /** Delete the entire history list. Useful for tests and manual resets. */
  async clearHistory(): Promise<void> {
    try {
      await this.redis.getClient().del(REDIS_KEY);
      this.logger.log('Backtest history cleared', this.context);
    } catch (e) {
      this.logger.warn(`Failed to clear backtest history: ${(e as Error).message}`, this.context);
    }
  }
}
