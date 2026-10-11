import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { RedisClientService } from '@infrastructure/redis/redis-client.service';
import { AlertsConfig } from '@config/alerts.config';
import { AlertCategory } from '../../domain/alert-category.enum';
import { AlertCondition } from '../../domain/alert-condition.enum';

export interface CooldownState {
  /** True when the fingerprint is within its cooldown window. */
  readonly suppressed: boolean;
  /** Current suppressed count for this fingerprint (within escalation window). */
  readonly suppressedCount: number;
  /** Seconds remaining in the cooldown window, or 0 if not suppressed. */
  readonly cooldownRemainingSeconds: number;
}

/**
 * AlertRateLimiterService prevents alert storms through per-fingerprint cooldowns.
 *
 * Strategy:
 *   1. Cooldown key: `alert:cooldown:<fingerprint>` — a Redis key with TTL=cooldownSeconds.
 *      If present, the alert is within its cooldown window.
 *
 *   2. Suppressed-count key: `alert:suppress:<fingerprint>` — a Redis counter with
 *      TTL=escalationWindowSeconds. Incremented each time an alert is suppressed.
 *      The escalation service reads this counter to decide when to escalate.
 *
 * Fallback:
 *   If Redis is unavailable, an in-memory Map provides best-effort rate limiting
 *   so the engine never throws and never blocks trading.
 *
 * Thread safety:
 *   Each XADD/EXPIRE pair is atomic per Redis's single-threaded model.
 *   In-memory fallback is protected by JS's single-threaded event loop.
 */
@Injectable()
export class AlertRateLimiterService {
  private readonly context = AlertRateLimiterService.name;

  /** In-memory fallback: fingerprint → expiry timestamp (ms). */
  private readonly inMemoryCooldown = new Map<string, number>();
  /** In-memory suppressed count: fingerprint → count. */
  private readonly inMemorySuppressCount = new Map<string, number>();

  private cooldownSeconds: number;
  private escalationWindowSeconds: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly redis: RedisClientService,
    private readonly logger: AppLoggerService,
  ) {
    const cfg = this.configService.get<AlertsConfig>('alerts')!;
    this.cooldownSeconds = cfg.cooldownSeconds;
    this.escalationWindowSeconds = cfg.escalationWindowSeconds;
  }

  /**
   * Compute the fingerprint for a (category, condition, source) triple.
   * sha256 → first 64 hex chars to stay within the varchar(64) column.
   */
  static buildFingerprint(
    category: AlertCategory,
    condition: AlertCondition,
    source: string,
  ): string {
    return createHash('sha256')
      .update(`${category}:${condition}:${source}`)
      .digest('hex')
      .substring(0, 64);
  }

  /**
   * Check whether an alert fingerprint is within its cooldown window.
   * Does NOT record a new cooldown — call `recordRaise()` separately.
   */
  async checkCooldown(fingerprint: string): Promise<CooldownState> {
    try {
      const client = this.redis.getClient();
      const cooldownKey = this.cooldownKey(fingerprint);
      const suppressKey = this.suppressCountKey(fingerprint);

      const [ttlStr, countStr] = await Promise.all([
        client.ttl(cooldownKey) as Promise<number>,
        client.get(suppressKey) as Promise<string | null>,
      ]);

      const suppressed = ttlStr > 0;
      const suppressedCount = countStr ? parseInt(countStr, 10) : 0;
      return {
        suppressed,
        suppressedCount,
        cooldownRemainingSeconds: suppressed ? ttlStr : 0,
      };
    } catch (error) {
      // Fallback to in-memory
      return this.checkCooldownInMemory(fingerprint);
    }
  }

  /**
   * Record a fresh raise. Sets (or resets) the cooldown key in Redis.
   * Call this when an alert is actually dispatched (not suppressed).
   */
  async recordRaise(fingerprint: string): Promise<void> {
    try {
      const client = this.redis.getClient();
      const cooldownKey = this.cooldownKey(fingerprint);
      // SET with EX is atomic
      await client.set(cooldownKey, '1', 'EX', this.cooldownSeconds);
      // Reset the suppression counter when a fresh alert fires
      await client.del(this.suppressCountKey(fingerprint));
      this.inMemoryCooldown.set(fingerprint, Date.now() + this.cooldownSeconds * 1_000);
      this.inMemorySuppressCount.delete(fingerprint);
    } catch (error) {
      this.logger.warn(
        `Rate limiter: Redis unavailable — using in-memory fallback (${(error as Error).message})`,
        this.context,
      );
      this.inMemoryCooldown.set(fingerprint, Date.now() + this.cooldownSeconds * 1_000);
      this.inMemorySuppressCount.delete(fingerprint);
    }
  }

  /**
   * Increment the suppressed-count for a fingerprint.
   * Returns the new count — used by the escalation service.
   */
  async incrementSuppressedCount(fingerprint: string): Promise<number> {
    try {
      const client = this.redis.getClient();
      const suppressKey = this.suppressCountKey(fingerprint);
      const newCount = (await client.incr(suppressKey)) as number;
      // Extend TTL to escalationWindowSeconds on each increment (sliding window)
      await client.expire(suppressKey, this.escalationWindowSeconds);
      return newCount;
    } catch {
      // In-memory fallback
      const prev = this.inMemorySuppressCount.get(fingerprint) ?? 0;
      const next = prev + 1;
      this.inMemorySuppressCount.set(fingerprint, next);
      return next;
    }
  }

  /**
   * Forcibly clear the cooldown and suppression state for a fingerprint.
   * Called when an alert is resolved (recovery event) so the next occurrence
   * is treated as fresh.
   */
  async clearCooldown(fingerprint: string): Promise<void> {
    try {
      const client = this.redis.getClient();
      await client.del(this.cooldownKey(fingerprint), this.suppressCountKey(fingerprint));
    } catch {
      // best-effort
    }
    this.inMemoryCooldown.delete(fingerprint);
    this.inMemorySuppressCount.delete(fingerprint);
  }

  // ── In-memory fallback ─────────────────────────────────────────────────────

  private checkCooldownInMemory(fingerprint: string): CooldownState {
    const expiry = this.inMemoryCooldown.get(fingerprint);
    if (!expiry || Date.now() >= expiry) {
      return { suppressed: false, suppressedCount: 0, cooldownRemainingSeconds: 0 };
    }
    const remaining = Math.ceil((expiry - Date.now()) / 1_000);
    const suppressedCount = this.inMemorySuppressCount.get(fingerprint) ?? 0;
    return { suppressed: true, suppressedCount, cooldownRemainingSeconds: remaining };
  }

  // ── Key helpers ────────────────────────────────────────────────────────────

  private cooldownKey(fingerprint: string): string {
    return `alert:cooldown:${fingerprint}`;
  }

  private suppressCountKey(fingerprint: string): string {
    return `alert:suppress:${fingerprint}`;
  }
}
