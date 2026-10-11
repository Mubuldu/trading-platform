import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { RedisClientService } from '@infrastructure/redis/redis-client.service';
import {
  PaperAccountState,
  PaperFillRecord,
  PaperDailyRecord,
  PaperPositionState,
} from '../../domain/models/paper-account-state.model';
import { PaperOpenOrder } from '../../domain/models/paper-open-order.model';

/**
 * PaperStateStoreService owns all Redis I/O for the paper trading subsystem.
 *
 * Key namespace: paper:*
 * All keys live under this prefix so they are visually isolated from live data
 * even when the Redis keyPrefix (e.g. "tp:") is applied at the client level.
 *
 * Keys:
 *   paper:account              — JSON blob of PaperAccountState
 *   paper:position:{symbol}    — JSON blob of PaperPositionState
 *   paper:openorder:{orderId}  — JSON blob of PaperOpenOrder
 *   paper:openorders:index     — Redis Set of open order IDs (fast scan)
 *   paper:fills                — Redis List of JSON PaperFillRecord (capped)
 *   paper:daily                — Redis List of JSON PaperDailyRecord
 */
@Injectable()
export class PaperStateStoreService {
  private static readonly ACCOUNT_KEY = 'paper:account';
  private static readonly POSITION_PREFIX = 'paper:position:';
  private static readonly OPENORDER_PREFIX = 'paper:openorder:';
  private static readonly OPENORDER_INDEX = 'paper:openorders:index';
  private static readonly FILLS_KEY = 'paper:fills';
  private static readonly DAILY_KEY = 'paper:daily';
  private static readonly MAX_FILLS = 10_000;
  private static readonly MAX_DAILY = 730;

  constructor(private readonly redis: RedisClientService) {}

  // ── Account ─────────────────────────────────────────────────────────────────

  async saveAccount(state: PaperAccountState): Promise<void> {
    await this.client.set(PaperStateStoreService.ACCOUNT_KEY, JSON.stringify(state));
  }

  async loadAccount(): Promise<PaperAccountState | null> {
    const raw = await this.client.get(PaperStateStoreService.ACCOUNT_KEY);
    return raw ? (JSON.parse(raw) as PaperAccountState) : null;
  }

  async deleteAccount(): Promise<void> {
    await this.client.del(PaperStateStoreService.ACCOUNT_KEY);
  }

  // ── Positions ────────────────────────────────────────────────────────────────

  async savePosition(pos: PaperPositionState): Promise<void> {
    const key = PaperStateStoreService.POSITION_PREFIX + pos.symbol;
    await this.client.set(key, JSON.stringify(pos));
  }

  async loadPosition(symbol: string): Promise<PaperPositionState | null> {
    const raw = await this.client.get(PaperStateStoreService.POSITION_PREFIX + symbol);
    return raw ? (JSON.parse(raw) as PaperPositionState) : null;
  }

  async loadAllPositions(): Promise<PaperPositionState[]> {
    const keys = await this.client.keys(PaperStateStoreService.POSITION_PREFIX + '*');
    if (keys.length === 0) return [];
    const raws = await this.client.mget(...keys);
    return raws.filter(Boolean).map((r) => JSON.parse(r!) as PaperPositionState);
  }

  async deleteAllPositions(): Promise<void> {
    const keys = await this.client.keys(PaperStateStoreService.POSITION_PREFIX + '*');
    if (keys.length > 0) await this.client.del(...keys);
  }

  // ── Open orders ──────────────────────────────────────────────────────────────

  async saveOpenOrder(order: PaperOpenOrder): Promise<void> {
    const key = PaperStateStoreService.OPENORDER_PREFIX + order.orderId;
    await this.client.set(key, JSON.stringify(order));
    await this.client.sadd(PaperStateStoreService.OPENORDER_INDEX, order.orderId);
  }

  async removeOpenOrder(orderId: string): Promise<void> {
    await this.client.del(PaperStateStoreService.OPENORDER_PREFIX + orderId);
    await this.client.srem(PaperStateStoreService.OPENORDER_INDEX, orderId);
  }

  async loadOpenOrder(orderId: string): Promise<PaperOpenOrder | null> {
    const raw = await this.client.get(PaperStateStoreService.OPENORDER_PREFIX + orderId);
    return raw ? (JSON.parse(raw) as PaperOpenOrder) : null;
  }

  async loadAllOpenOrders(): Promise<PaperOpenOrder[]> {
    const ids = await this.client.smembers(PaperStateStoreService.OPENORDER_INDEX);
    if (ids.length === 0) return [];
    const keys = ids.map((id) => PaperStateStoreService.OPENORDER_PREFIX + id);
    const raws = await this.client.mget(...keys);
    return raws.filter(Boolean).map((r) => JSON.parse(r!) as PaperOpenOrder);
  }

  async deleteAllOpenOrders(): Promise<void> {
    const ids = await this.client.smembers(PaperStateStoreService.OPENORDER_INDEX);
    if (ids.length > 0) {
      const keys = ids.map((id) => PaperStateStoreService.OPENORDER_PREFIX + id);
      await this.client.del(...keys);
    }
    await this.client.del(PaperStateStoreService.OPENORDER_INDEX);
  }

  // ── Fill records ─────────────────────────────────────────────────────────────

  async appendFill(fill: PaperFillRecord): Promise<void> {
    await this.client.rpush(PaperStateStoreService.FILLS_KEY, JSON.stringify(fill));
    // Keep only the most recent N fills to bound memory
    const len = await this.client.llen(PaperStateStoreService.FILLS_KEY);
    if (len > PaperStateStoreService.MAX_FILLS) {
      await this.client.ltrim(
        PaperStateStoreService.FILLS_KEY,
        -PaperStateStoreService.MAX_FILLS,
        -1,
      );
    }
  }

  async loadFills(limit = 500): Promise<PaperFillRecord[]> {
    const raws = await this.client.lrange(PaperStateStoreService.FILLS_KEY, -limit, -1);
    return raws.map((r) => JSON.parse(r) as PaperFillRecord);
  }

  async countFills(): Promise<number> {
    return this.client.llen(PaperStateStoreService.FILLS_KEY);
  }

  async deleteAllFills(): Promise<void> {
    await this.client.del(PaperStateStoreService.FILLS_KEY);
  }

  // ── Daily PnL records ────────────────────────────────────────────────────────

  async appendOrUpdateDaily(record: PaperDailyRecord): Promise<void> {
    const all = await this.loadDailyRecords();
    const idx = all.findIndex((r) => r.date === record.date);
    if (idx >= 0) {
      all[idx] = record;
      await this.client.del(PaperStateStoreService.DAILY_KEY);
      for (const r of all) {
        await this.client.rpush(PaperStateStoreService.DAILY_KEY, JSON.stringify(r));
      }
    } else {
      await this.client.rpush(PaperStateStoreService.DAILY_KEY, JSON.stringify(record));
      const len = await this.client.llen(PaperStateStoreService.DAILY_KEY);
      if (len > PaperStateStoreService.MAX_DAILY) {
        await this.client.ltrim(
          PaperStateStoreService.DAILY_KEY,
          -PaperStateStoreService.MAX_DAILY,
          -1,
        );
      }
    }
  }

  async loadDailyRecords(limit = 400): Promise<PaperDailyRecord[]> {
    const raws = await this.client.lrange(PaperStateStoreService.DAILY_KEY, -limit, -1);
    return raws.map((r) => JSON.parse(r) as PaperDailyRecord);
  }

  async deleteAllDailyRecords(): Promise<void> {
    await this.client.del(PaperStateStoreService.DAILY_KEY);
  }

  // ── Full reset ───────────────────────────────────────────────────────────────

  async resetAll(): Promise<void> {
    await Promise.all([
      this.deleteAccount(),
      this.deleteAllPositions(),
      this.deleteAllOpenOrders(),
      this.deleteAllFills(),
      this.deleteAllDailyRecords(),
    ]);
  }

  // ── Convenience ─────────────────────────────────────────────────────────────

  private get client(): Redis {
    return this.redis.getClient();
  }
}
