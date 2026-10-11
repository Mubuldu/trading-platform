import { Injectable } from '@nestjs/common';
import { RedisHashService } from '@infrastructure/redis/hash/redis-hash.service';
import { PositionModel } from '../../domain/models/position.model';

@Injectable()
export class PositionCacheService {
  private readonly hashKey = 'positions:cache';

  constructor(private readonly hash: RedisHashService) {}

  async save(position: PositionModel): Promise<void> {
    const field = this.field(position.exchangeId, position.symbol);
    await this.hash.set(this.hashKey, field, JSON.stringify(position));
  }

  async load(exchangeId: string, symbol: string): Promise<PositionModel | null> {
    const field = this.field(exchangeId, symbol);
    const raw = await this.hash.get<string>(this.hashKey, field);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PositionModel;
    } catch {
      return null;
    }
  }

  async delete(exchangeId: string, symbol: string): Promise<void> {
    const field = this.field(exchangeId, symbol);
    await this.hash.delete(this.hashKey, field);
  }

  async loadAll(): Promise<PositionModel[]> {
    const all = await this.hash.getAll<Record<string, string>>(this.hashKey);
    if (!all) return [];
    return Object.values(all)
      .map((raw) => {
        try {
          return JSON.parse(raw) as PositionModel;
        } catch {
          return null;
        }
      })
      .filter((p): p is PositionModel => p !== null);
  }

  private field(exchangeId: string, symbol: string): string {
    return `${exchangeId}:${symbol}`;
  }
}
