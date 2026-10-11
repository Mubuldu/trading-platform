import { Injectable } from '@nestjs/common';
import { RedisClientService } from '../redis-client.service';

export type HashField = string | number | boolean | null;

@Injectable()
export class RedisHashService {
  constructor(private readonly redisClient: RedisClientService) {}

  async set(key: string, field: string, value: HashField): Promise<void> {
    await this.redisClient.getClient().hset(key, field, this.serialize(value));
  }

  async setMultiple(key: string, fields: Record<string, HashField>): Promise<void> {
    const flat: string[] = [];
    for (const [k, v] of Object.entries(fields)) {
      flat.push(k, this.serialize(v));
    }
    if (flat.length > 0) {
      await this.redisClient.getClient().hset(key, ...flat);
    }
  }

  async get<T = string>(key: string, field: string): Promise<T | null> {
    const value = await this.redisClient.getClient().hget(key, field);
    if (value === null) return null;
    return this.deserialize<T>(value);
  }

  async getAll<T = Record<string, unknown>>(key: string): Promise<T | null> {
    const raw = await this.redisClient.getClient().hgetall(key);
    if (!raw || Object.keys(raw).length === 0) return null;
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      result[k] = this.deserialize(v);
    }
    return result as T;
  }

  async delete(key: string, ...fields: string[]): Promise<number> {
    const raw = await this.redisClient.getClient().hdel(key, ...fields);
    return raw as unknown as number;
  }

  async exists(key: string, field: string): Promise<boolean> {
    const result = await this.redisClient.getClient().hexists(key, field);
    return result === 1;
  }

  async increment(key: string, field: string, by = 1): Promise<number> {
    const raw = await this.redisClient.getClient().hincrbyfloat(key, field, by);
    return parseFloat(raw);
  }

  async getFields(key: string, ...fields: string[]): Promise<(unknown | null)[]> {
    const values = (await this.redisClient.getClient().hmget(key, ...fields)) as (string | null)[];
    return values.map((v) => (v === null ? null : this.deserialize(v)));
  }

  async setWithExpiry(
    key: string,
    fields: Record<string, HashField>,
    ttlMs: number,
  ): Promise<void> {
    await this.setMultiple(key, fields);
    await this.redisClient.getClient().pexpire(key, ttlMs);
  }

  private serialize(value: HashField): string {
    if (value === null) return '__null__';
    if (typeof value === 'boolean') return value ? '__true__' : '__false__';
    return String(value);
  }

  private deserialize<T>(value: string): T {
    if (value === '__null__') return null as T;
    if (value === '__true__') return true as T;
    if (value === '__false__') return false as T;
    const num = Number(value);
    if (!isNaN(num) && value.trim() !== '') return num as T;
    return value as T;
  }
}
