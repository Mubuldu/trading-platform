import { Injectable } from '@nestjs/common';
import { RedisClientService } from '../redis-client.service';

export interface SortedSetEntry<T = string> {
  score: number;
  value: T;
}

@Injectable()
export class RedisSortedSetService {
  constructor(private readonly redisClient: RedisClientService) {}

  async add(key: string, score: number, member: string): Promise<number> {
    return this.redisClient.getClient().zadd(key, score, member) as Promise<number>;
  }

  async addMultiple(key: string, entries: SortedSetEntry<string>[]): Promise<number> {
    if (entries.length === 0) return 0;
    const flat: (string | number)[] = [];
    for (const e of entries) {
      flat.push(e.score, e.value);
    }
    return this.redisClient.getClient().zadd(key, ...flat) as Promise<number>;
  }

  async addJson<T>(key: string, score: number, value: T): Promise<number> {
    return this.add(key, score, JSON.stringify(value));
  }

  async addJsonMultiple<T>(key: string, entries: SortedSetEntry<T>[]): Promise<number> {
    return this.addMultiple(
      key,
      entries.map((e) => ({ score: e.score, value: JSON.stringify(e.value) })),
    );
  }

  async rangeByScore<T>(
    key: string,
    minScore: number | '-inf',
    maxScore: number | '+inf',
    options?: { limit?: number; offset?: number },
  ): Promise<SortedSetEntry<T>[]> {
    const client = this.redisClient.getClient();
    const min = minScore === '-inf' ? '-inf' : String(minScore);
    const max = maxScore === '+inf' ? '+inf' : String(maxScore);

    let raw: string[];
    if (options?.limit !== undefined) {
      raw = (await client.zrangebyscore(
        key,
        min,
        max,
        'WITHSCORES',
        'LIMIT',
        options.offset ?? 0,
        options.limit,
      )) as string[];
    } else {
      raw = (await client.zrangebyscore(key, min, max, 'WITHSCORES')) as string[];
    }

    return this.parseWithScores<T>(raw);
  }

  async rangeByScoreReverse<T>(
    key: string,
    maxScore: number | '+inf',
    minScore: number | '-inf',
    limit?: number,
  ): Promise<SortedSetEntry<T>[]> {
    const client = this.redisClient.getClient();
    const max = maxScore === '+inf' ? '+inf' : String(maxScore);
    const min = minScore === '-inf' ? '-inf' : String(minScore);

    let raw: string[];
    if (limit !== undefined) {
      raw = (await client.zrevrangebyscore(
        key,
        max,
        min,
        'WITHSCORES',
        'LIMIT',
        0,
        limit,
      )) as string[];
    } else {
      raw = (await client.zrevrangebyscore(key, max, min, 'WITHSCORES')) as string[];
    }

    return this.parseWithScores<T>(raw);
  }

  async getLatest<T>(key: string, count: number): Promise<SortedSetEntry<T>[]> {
    return this.rangeByScoreReverse<T>(key, '+inf', '-inf', count);
  }

  async removeByScore(
    key: string,
    minScore: number | '-inf',
    maxScore: number | '+inf',
  ): Promise<number> {
    const min = minScore === '-inf' ? '-inf' : String(minScore);
    const max = maxScore === '+inf' ? '+inf' : String(maxScore);
    return this.redisClient.getClient().zremrangebyscore(key, min, max) as Promise<number>;
  }

  async trimToMaxSize(key: string, maxSize: number): Promise<number> {
    const size = (await this.redisClient.getClient().zcard(key)) as number;
    if (size <= maxSize) return 0;
    const removeCount = size - maxSize;
    return this.redisClient.getClient().zremrangebyrank(key, 0, removeCount - 1) as Promise<number>;
  }

  async count(key: string): Promise<number> {
    return this.redisClient.getClient().zcard(key) as Promise<number>;
  }

  async countInRange(
    key: string,
    minScore: number | '-inf',
    maxScore: number | '+inf',
  ): Promise<number> {
    const min = minScore === '-inf' ? '-inf' : String(minScore);
    const max = maxScore === '+inf' ? '+inf' : String(maxScore);
    return this.redisClient.getClient().zcount(key, min, max) as Promise<number>;
  }

  async setWithExpiry(
    key: string,
    entries: SortedSetEntry<string>[],
    ttlMs: number,
  ): Promise<void> {
    await this.addMultiple(key, entries);
    await this.redisClient.getClient().pexpire(key, ttlMs);
  }

  private parseWithScores<T>(raw: string[]): SortedSetEntry<T>[] {
    const result: SortedSetEntry<T>[] = [];
    for (let i = 0; i < raw.length - 1; i += 2) {
      const member = raw[i];
      const score = parseFloat(raw[i + 1]);
      let value: T;
      try {
        value = JSON.parse(member) as T;
      } catch {
        value = member as unknown as T;
      }
      result.push({ score, value });
    }
    return result;
  }
}
