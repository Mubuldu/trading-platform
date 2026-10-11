import { Injectable } from '@nestjs/common';
import { RedisHashService } from '@infrastructure/redis/hash/redis-hash.service';
import { OrderModel } from '../../domain/models/order.model';

@Injectable()
export class OrderCacheService {
  private readonly activeKey = 'orders:active';
  private readonly seenReportsKey = 'orders:seen-reports';

  constructor(private readonly hash: RedisHashService) {}

  async save(order: OrderModel): Promise<void> {
    await this.hash.set(this.activeKey, order.clientOrderId, JSON.stringify(order));
  }

  async load(clientOrderId: string): Promise<OrderModel | null> {
    const raw = await this.hash.get<string>(this.activeKey, clientOrderId);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as OrderModel;
    } catch {
      return null;
    }
  }

  async loadAll(): Promise<OrderModel[]> {
    const all = await this.hash.getAll<Record<string, string>>(this.activeKey);
    if (!all) return [];
    return Object.values(all)
      .map((raw) => {
        try {
          return JSON.parse(raw) as OrderModel;
        } catch {
          return null;
        }
      })
      .filter((o): o is OrderModel => o !== null);
  }

  async remove(clientOrderId: string): Promise<void> {
    await this.hash.delete(this.activeKey, clientOrderId);
  }

  async markReportSeen(reportId: string): Promise<void> {
    await this.hash.set(this.seenReportsKey, reportId, '1');
  }

  async isReportSeen(reportId: string): Promise<boolean> {
    const val = await this.hash.get<string>(this.seenReportsKey, reportId);
    return val !== null;
  }
}
