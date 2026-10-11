import { Injectable } from '@nestjs/common';
import { RedisHashService } from '@infrastructure/redis/hash/redis-hash.service';
import { PortfolioStateModel, PositionSummary } from '../../domain/models/portfolio-state.model';
import { DailyPnlRecord } from '../../domain/models/performance.model';

const STATE_KEY = 'portfolio:state';
const POSITIONS_KEY = 'portfolio:positions';
const DAILY_PNL_KEY = 'portfolio:daily-pnl';
const MAX_DAILY_RECORDS = 400;

@Injectable()
export class PortfolioCacheService {
  constructor(private readonly hash: RedisHashService) {}

  async saveState(state: PortfolioStateModel): Promise<void> {
    await this.hash.set(STATE_KEY, 'current', JSON.stringify(state));
  }

  async loadState(): Promise<PortfolioStateModel | null> {
    const raw = await this.hash.get<string>(STATE_KEY, 'current');
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PortfolioStateModel;
    } catch {
      return null;
    }
  }

  async savePosition(position: PositionSummary): Promise<void> {
    await this.hash.set(POSITIONS_KEY, position.positionId, JSON.stringify(position));
  }

  async loadAllPositions(): Promise<PositionSummary[]> {
    const all = await this.hash.getAll<Record<string, string>>(POSITIONS_KEY);
    if (!all) return [];
    return Object.values(all)
      .map((raw) => {
        try {
          return JSON.parse(raw) as PositionSummary;
        } catch {
          return null;
        }
      })
      .filter((p): p is PositionSummary => p !== null);
  }

  async removePosition(positionId: string): Promise<void> {
    await this.hash.delete(POSITIONS_KEY, positionId);
  }

  async loadDailyPnl(): Promise<DailyPnlRecord[]> {
    const raw = await this.hash.get<string>(DAILY_PNL_KEY, 'records');
    if (!raw) return [];
    try {
      return JSON.parse(raw) as DailyPnlRecord[];
    } catch {
      return [];
    }
  }

  async appendDailyRecord(record: DailyPnlRecord): Promise<void> {
    const records = await this.loadDailyPnl();
    const existing = records.findIndex((r) => r.date === record.date);
    if (existing >= 0) {
      records[existing] = record;
    } else {
      records.push(record);
    }
    const trimmed = records.slice(-MAX_DAILY_RECORDS);
    await this.hash.set(DAILY_PNL_KEY, 'records', JSON.stringify(trimmed));
  }
}
