import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { RedisClientService } from '@infrastructure/redis/redis-client.service';
import { AppLoggerService } from '@core/logging/app-logger.service';

// ─── Public types ──────────────────────────────────────────────────────────────

export interface RiskMetrics {
  readonly dailyLoss: number;
  readonly dailyTradeCount: number;
  readonly consecutiveLosses: number;
  readonly consecutiveWins: number;
  readonly currentDrawdownPercent: number;
  readonly peakEquity: number;
  readonly currentEquity: number;
  readonly isKillSwitchActive: boolean;
  readonly isTradingPaused: boolean;
  readonly isExposureLocked: boolean;
  readonly winRate: number;
  readonly kellyFraction: number;
  readonly avgWinLossRatio: number;
  readonly totalTrades: number;
}

// ─── Internal state ────────────────────────────────────────────────────────────

interface TradingStats {
  peakEquity: number;
  currentEquity: number;
  dailyStartEquity: number;
  /** UTC timestamp (ms) of the start of the current trading day window. */
  dayStart: number;
  dailyLoss: number;
  dailyTradeCount: number;
  consecutiveLosses: number;
  consecutiveWins: number;
  totalWins: number;
  totalLosses: number;
  totalWinPnl: number;
  totalLossPnl: number;
  isKillSwitchActive: boolean;
  isTradingPaused: boolean;
  isExposureLocked: boolean;
}

// ─── Redis key constants ───────────────────────────────────────────────────────

/**
 * Redis keys used for durable risk-state persistence.
 *
 * Control flags (kill switch, pause, exposure lock) have no TTL — they persist
 * until explicitly cleared by a risk officer.
 *
 * The daily state is stored in a Redis Hash and is only restored on startup
 * if the stored day matches the current UTC calendar day (preventing yesterday's
 * loss accumulator from counting against today after a restart near midnight).
 */
const RKEY = {
  KILL_SWITCH: 'risk:state:kill-switch',
  TRADING_PAUSED: 'risk:state:trading-paused',
  EXPOSURE_LOCKED: 'risk:state:exposure-locked',
  /** Hash fields: loss (float), tradeCount (int), dayStart (int ms timestamp) */
  DAILY: 'risk:state:daily',
  /**
   * Hash fields: totalWins, totalLosses, totalWinPnl, totalLossPnl,
   *              consecutiveLosses, consecutiveWins, peakEquity
   *
   * Persisted on every trade so restart does not reset win rate / streaks / drawdown.
   */
  LIFETIME: 'risk:state:lifetime',
} as const;

const MS_PER_DAY = 86_400_000;

// ─── Service ───────────────────────────────────────────────────────────────────

/**
 * RiskStateService — single source of truth for in-flight risk metrics.
 *
 * ## Persistence
 * When a `RedisClientService` is available (injected via NestJS DI), the three
 * control flags and the daily loss state are written to Redis on every mutation.
 * On `onModuleInit()` this state is restored, so:
 *   - An engaged kill switch survives pod restarts / rolling deploys.
 *   - Today's accumulated losses are not reset by a restart.
 *
 * When Redis is unavailable (e.g. in pure unit tests that call
 * `new RiskStateService()` directly), the service degrades gracefully to
 * in-memory only and logs a warning.
 *
 * ## Daily window
 * The daily loss window rolls at UTC calendar day boundaries (not "24 hours
 * since process start"), preventing double-counting when a restart happens
 * near midnight.
 *
 * ## Thread safety
 * Node.js is single-threaded; no locking is needed for the in-memory stats.
 * Redis writes are fire-and-log: they do not block the caller.
 */
@Injectable()
export class RiskStateService implements OnModuleInit {
  private readonly context = RiskStateService.name;
  private stats: TradingStats;

  /**
   * Both dependencies are @Optional so that `new RiskStateService()` (used in
   * unit tests) works without a DI container.  In production NestJS boots both
   * RedisModule (@Global) and LoggingModule (@Global) before RiskModule, so
   * they are always injected in the real application.
   */
  constructor(
    @Optional() private readonly redis?: RedisClientService,
    @Optional() private readonly logger?: AppLoggerService,
  ) {
    this.stats = this.freshStats();
  }

  async onModuleInit(): Promise<void> {
    if (!this.redis) {
      this.logger?.warn(
        'RiskStateService running WITHOUT Redis persistence — kill switch and daily state ' +
          'will NOT survive process restarts. Ensure CLUSTER_ENABLED=true in production.',
        this.context,
      );
      return;
    }
    await this.restoreFromRedis();
  }

  // ── Equity tracking ──────────────────────────────────────────────────────────

  initEquity(equity: number): void {
    if (this.stats.peakEquity === 0) {
      this.stats.peakEquity = equity;
      this.stats.currentEquity = equity;
      this.stats.dailyStartEquity = equity;
    }
  }

  recordEquity(equity: number): void {
    this.rollDayIfNeeded();
    this.stats.currentEquity = equity;
    if (equity > this.stats.peakEquity) {
      this.stats.peakEquity = equity;
    }
  }

  recordTrade(pnl: number): void {
    this.rollDayIfNeeded();
    this.stats.dailyTradeCount++;

    if (pnl >= 0) {
      this.stats.consecutiveWins++;
      this.stats.consecutiveLosses = 0;
      this.stats.totalWins++;
      this.stats.totalWinPnl += pnl;
    } else {
      this.stats.consecutiveLosses++;
      this.stats.consecutiveWins = 0;
      this.stats.totalLosses++;
      this.stats.totalLossPnl += Math.abs(pnl);
      this.stats.dailyLoss += Math.abs(pnl);
    }

    this.stats.currentEquity += pnl;
    if (this.stats.currentEquity > this.stats.peakEquity) {
      this.stats.peakEquity = this.stats.currentEquity;
    }

    this.persistDailyState();
    this.persistLifetimeState();
  }

  // ── Emergency controls ───────────────────────────────────────────────────────

  /**
   * Engages the kill switch.
   *
   * Takes effect **immediately** in memory — all subsequent risk checks see it
   * as active before this method returns.  The Redis persist is asynchronous
   * (fire-and-log); a Redis failure does NOT prevent the in-memory switch from
   * activating.
   */
  triggerKillSwitch(): void {
    this.stats.isKillSwitchActive = true;
    this.persistFlag(RKEY.KILL_SWITCH, true);
    this.logger?.warn(
      '⚠  Kill switch ENGAGED — all new trade signals will be blocked',
      this.context,
    );
  }

  /**
   * Clears the kill switch.  Must be called explicitly by a risk officer after
   * reviewing the situation.  Persisted to Redis asynchronously.
   */
  resetKillSwitch(): void {
    this.stats.isKillSwitchActive = false;
    this.persistFlag(RKEY.KILL_SWITCH, false);
    this.logger?.warn('Kill switch CLEARED — trading may resume', this.context);
  }

  pauseTrading(): void {
    this.stats.isTradingPaused = true;
    this.persistFlag(RKEY.TRADING_PAUSED, true);
  }

  lockExposure(): void {
    this.stats.isExposureLocked = true;
    this.persistFlag(RKEY.EXPOSURE_LOCKED, true);
  }

  resume(): void {
    this.stats.isTradingPaused = false;
    this.stats.isExposureLocked = false;
    this.persistFlag(RKEY.TRADING_PAUSED, false);
    this.persistFlag(RKEY.EXPOSURE_LOCKED, false);
  }

  // ── Getters ──────────────────────────────────────────────────────────────────

  getCurrentDrawdownPercent(): number {
    if (this.stats.peakEquity <= 0) return 0;
    return ((this.stats.peakEquity - this.stats.currentEquity) / this.stats.peakEquity) * 100;
  }

  getDailyLoss(): number {
    this.rollDayIfNeeded();
    return this.stats.dailyLoss;
  }

  getDailyTradeCount(): number {
    this.rollDayIfNeeded();
    return this.stats.dailyTradeCount;
  }

  getConsecutiveLosses(): number {
    return this.stats.consecutiveLosses;
  }

  getConsecutiveWins(): number {
    return this.stats.consecutiveWins;
  }

  isKillSwitchActive(): boolean {
    return this.stats.isKillSwitchActive;
  }

  isTradingPaused(): boolean {
    return this.stats.isTradingPaused;
  }

  isExposureLocked(): boolean {
    return this.stats.isExposureLocked;
  }

  getMetrics(): RiskMetrics {
    this.rollDayIfNeeded();
    const totalTrades = this.stats.totalWins + this.stats.totalLosses;
    const winRate = totalTrades > 0 ? this.stats.totalWins / totalTrades : 0;
    const avgWin = this.stats.totalWins > 0 ? this.stats.totalWinPnl / this.stats.totalWins : 0;
    const avgLoss =
      this.stats.totalLosses > 0 ? this.stats.totalLossPnl / this.stats.totalLosses : 1;
    const avgWinLossRatio = avgLoss > 0 ? avgWin / avgLoss : 0;
    const kelly = this.computeKelly(winRate, avgWinLossRatio);

    return {
      dailyLoss: this.stats.dailyLoss,
      dailyTradeCount: this.stats.dailyTradeCount,
      consecutiveLosses: this.stats.consecutiveLosses,
      consecutiveWins: this.stats.consecutiveWins,
      currentDrawdownPercent: this.getCurrentDrawdownPercent(),
      peakEquity: this.stats.peakEquity,
      currentEquity: this.stats.currentEquity,
      isKillSwitchActive: this.stats.isKillSwitchActive,
      isTradingPaused: this.stats.isTradingPaused,
      isExposureLocked: this.stats.isExposureLocked,
      winRate,
      kellyFraction: kelly,
      avgWinLossRatio,
      totalTrades,
    };
  }

  /**
   * Seeds lifetime win/loss counters from historical fill data on first startup.
   *
   * Called by PaperPositionManagerService after onModuleInit() restores fills,
   * but only when restoreFromRedis() found no lifetime data (all zeros). This
   * ensures that win rate and total trades are correct immediately after the
   * first deploy of this feature rather than showing 0 until the next trade closes.
   *
   * Guards against double-counting: does nothing if totalTrades is already > 0.
   */
  seedLifetimeStats(opts: {
    totalWins: number;
    totalLosses: number;
    totalWinPnl: number;
    totalLossPnl: number;
  }): void {
    if (this.stats.totalWins + this.stats.totalLosses > 0) return; // already has live data
    this.stats.totalWins = opts.totalWins;
    this.stats.totalLosses = opts.totalLosses;
    this.stats.totalWinPnl = opts.totalWinPnl;
    this.stats.totalLossPnl = opts.totalLossPnl;
    const total = opts.totalWins + opts.totalLosses;
    const wr = total > 0 ? ((opts.totalWins / total) * 100).toFixed(1) : '0.0';
    this.logger?.log(
      `Lifetime risk stats seeded from fill history: ${total} trades, winRate=${wr}%`,
      this.context,
    );
    this.persistLifetimeState();
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private freshStats(): TradingStats {
    return {
      peakEquity: 0,
      currentEquity: 0,
      dailyStartEquity: 0,
      dayStart: Date.now(),
      dailyLoss: 0,
      dailyTradeCount: 0,
      consecutiveLosses: 0,
      consecutiveWins: 0,
      totalWins: 0,
      totalLosses: 0,
      totalWinPnl: 0,
      totalLossPnl: 0,
      isKillSwitchActive: false,
      isTradingPaused: false,
      isExposureLocked: false,
    };
  }

  private computeKelly(winRate: number, avgWinLossRatio: number): number {
    if (avgWinLossRatio <= 0) return 0;
    return Math.max(0, winRate - (1 - winRate) / avgWinLossRatio);
  }

  /**
   * Rolls the daily window when `now` is in a different UTC calendar day than
   * `stats.dayStart`.
   *
   * Uses floor-division by MS_PER_DAY rather than ">= 24h elapsed" to prevent
   * a restart at 23:58 UTC from treating 00:02 UTC as "still the same day".
   */
  private rollDayIfNeeded(): void {
    const now = Date.now();
    if (!this.isSameUtcDay(this.stats.dayStart, now)) {
      this.stats.dayStart = now;
      this.stats.dailyLoss = 0;
      this.stats.dailyTradeCount = 0;
      this.stats.dailyStartEquity = this.stats.currentEquity;
      // Persist the fresh day so a restart within this new day restores correctly.
      this.persistDailyState();
    }
  }

  /** True when both timestamps fall within the same UTC calendar day. */
  private isSameUtcDay(tsA: number, tsB: number): boolean {
    return Math.floor(tsA / MS_PER_DAY) === Math.floor(tsB / MS_PER_DAY);
  }

  /**
   * Fire-and-log: writes or deletes a boolean Redis control flag.
   * Does not block the caller.  Errors are logged but never thrown.
   */
  private persistFlag(key: string, active: boolean): void {
    if (!this.redis) return;
    const client = this.redis.getClient();
    const op = active ? client.set(key, '1') : client.del(key);
    void op.catch((err: Error) =>
      this.logger?.error(
        `Failed to persist risk flag [${key}]: ${err.message}`,
        err.stack,
        this.context,
      ),
    );
  }

  /**
   * Fire-and-log: writes today's daily loss state to a Redis Hash.
   * Does not block the caller.  Errors are logged but never thrown.
   */
  private persistDailyState(): void {
    if (!this.redis) return;
    const client = this.redis.getClient();
    void client
      .hset(RKEY.DAILY, {
        loss: String(this.stats.dailyLoss),
        tradeCount: String(this.stats.dailyTradeCount),
        dayStart: String(this.stats.dayStart),
      })
      .catch((err: Error) =>
        this.logger?.error(
          `Failed to persist daily risk state: ${err.message}`,
          err.stack,
          this.context,
        ),
      );
  }

  /**
   * Fire-and-log: writes lifetime trade stats to a Redis Hash so they survive
   * process restarts. Without this, win rate, consecutive streaks, and total
   * trade count reset to 0 every time the bot restarts.
   */
  private persistLifetimeState(): void {
    if (!this.redis) return;
    const client = this.redis.getClient();
    void client
      .hset(RKEY.LIFETIME, {
        totalWins: String(this.stats.totalWins),
        totalLosses: String(this.stats.totalLosses),
        totalWinPnl: String(this.stats.totalWinPnl),
        totalLossPnl: String(this.stats.totalLossPnl),
        consecutiveLosses: String(this.stats.consecutiveLosses),
        consecutiveWins: String(this.stats.consecutiveWins),
        peakEquity: String(this.stats.peakEquity),
      })
      .catch((err: Error) =>
        this.logger?.error(
          `Failed to persist lifetime risk state: ${err.message}`,
          err.stack,
          this.context,
        ),
      );
  }

  /**
   * Restores persisted risk state from Redis on startup.
   *
   * Control flags (kill switch, pause, exposure lock) are always restored.
   * Daily state is restored only when the stored `dayStart` falls within the
   * current UTC calendar day — prevents yesterday's accumulated loss from
   * counting against today after a restart near midnight.
   */
  private async restoreFromRedis(): Promise<void> {
    const client = this.redis!.getClient();
    try {
      const [killSwitch, tradingPaused, exposureLocked, daily, lifetime] = await Promise.all([
        client.get(RKEY.KILL_SWITCH),
        client.get(RKEY.TRADING_PAUSED),
        client.get(RKEY.EXPOSURE_LOCKED),
        client.hgetall(RKEY.DAILY),
        client.hgetall(RKEY.LIFETIME),
      ]);

      // ── Control flags ──────────────────────────────────────────────────────
      this.stats.isKillSwitchActive = killSwitch === '1';
      this.stats.isTradingPaused = tradingPaused === '1';
      this.stats.isExposureLocked = exposureLocked === '1';

      // ── Daily state ────────────────────────────────────────────────────────
      if (daily) {
        const storedDayStart = parseInt(daily.dayStart ?? '0', 10);
        if (storedDayStart > 0 && this.isSameUtcDay(storedDayStart, Date.now())) {
          this.stats.dailyLoss = parseFloat(daily.loss ?? '0');
          this.stats.dailyTradeCount = parseInt(daily.tradeCount ?? '0', 10);
          this.stats.dayStart = storedDayStart;
          this.logger?.log(
            `Daily risk state restored: loss=$${this.stats.dailyLoss.toFixed(2)}, ` +
              `trades=${this.stats.dailyTradeCount}`,
            this.context,
          );
        } else if (storedDayStart > 0) {
          this.logger?.log(
            'Stored daily risk state is from a previous UTC day — starting fresh',
            this.context,
          );
        }
      }

      // ── Lifetime state ─────────────────────────────────────────────────────
      // Restoring these means win rate, consecutive streaks, and total trade
      // count are accurate immediately after restart — not reset to zero.
      if (lifetime) {
        this.stats.totalWins = parseInt(lifetime.totalWins ?? '0', 10);
        this.stats.totalLosses = parseInt(lifetime.totalLosses ?? '0', 10);
        this.stats.totalWinPnl = parseFloat(lifetime.totalWinPnl ?? '0');
        this.stats.totalLossPnl = parseFloat(lifetime.totalLossPnl ?? '0');
        this.stats.consecutiveLosses = parseInt(lifetime.consecutiveLosses ?? '0', 10);
        this.stats.consecutiveWins = parseInt(lifetime.consecutiveWins ?? '0', 10);
        this.stats.peakEquity = parseFloat(lifetime.peakEquity ?? '0');
        const total = this.stats.totalWins + this.stats.totalLosses;
        if (total > 0) {
          this.logger?.log(
            `Lifetime risk state restored: ${total} trades, ` +
              `winRate=${((this.stats.totalWins / total) * 100).toFixed(1)}%, ` +
              `peakEquity=$${this.stats.peakEquity.toFixed(2)}`,
            this.context,
          );
        }
      }

      // ── Prominent warnings for active controls ─────────────────────────────
      if (this.stats.isKillSwitchActive) {
        this.logger?.warn(
          '⚠  Kill switch RESTORED from Redis — trading is HALTED. ' +
            'Call resetKillSwitch() to resume after reviewing the situation.',
          this.context,
        );
      }
      if (this.stats.isTradingPaused) {
        this.logger?.warn('Trading pause RESTORED from Redis', this.context);
      }
      if (this.stats.isExposureLocked) {
        this.logger?.warn('Exposure lock RESTORED from Redis', this.context);
      }
    } catch (err) {
      // Redis restore failure must not crash the process, but it is serious:
      // if a kill switch was previously active, it is now silently cleared.
      this.logger?.error(
        'Failed to restore risk state from Redis — proceeding with CLEAN state. ' +
          'If a kill switch was previously engaged it is NO LONGER ACTIVE.',
        (err as Error).stack,
        this.context,
      );
    }
  }
}
