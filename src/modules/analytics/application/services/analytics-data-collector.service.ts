import { Injectable } from '@nestjs/common';
import { PaperStateStoreService } from '@modules/paper-trading/infrastructure/store/paper-state-store.service';
import { PaperAccountService } from '@modules/paper-trading/application/services/paper-account.service';
import { PaperPortfolioManagerService } from '@modules/paper-trading/application/services/paper-portfolio-manager.service';
import {
  PaperAccountState,
  PaperFillRecord,
} from '@modules/paper-trading/domain/models/paper-account-state.model';
import {
  AnalyticsTrade,
  AnalyticsFill,
  AnalyticsEquityPoint,
  AnalyticsPositionSnapshot,
} from '../../domain/models/analytics-trade.model';
import { DailyCapitalRecord } from '../calculators/capital-metrics.calculator';

/**
 * AnalyticsDataCollectorService reads paper trading state from Redis and
 * converts it into the analytics domain types consumed by the calculators.
 *
 * This service is the only place that knows about paper trading internals.
 * All other analytics services operate purely on analytics domain types.
 *
 * Trade reconstruction algorithm (FIFO average-cost):
 *   1. Process fills chronologically per (strategyId, symbol)
 *   2. Track running quantity (positive = long, negative = short)
 *   3. On each fill:
 *      a. If adding to position → update avgEntryPrice (weighted average)
 *      b. If reducing position → record trade with realized PnL
 *   4. When running quantity reaches 0 → trade is complete
 */
@Injectable()
export class AnalyticsDataCollectorService {
  private static readonly MAX_FILLS = 10_000;
  private static readonly PAPER_EXCHANGE_ID = 'paper_trading';

  constructor(
    private readonly store: PaperStateStoreService,
    private readonly account: PaperAccountService,
    private readonly portfolio: PaperPortfolioManagerService,
  ) {}

  // ── Public API ───────────────────────────────────────────────────────────────

  async collectTrades(limit = AnalyticsDataCollectorService.MAX_FILLS): Promise<AnalyticsTrade[]> {
    const fills = await this.store.loadFills(limit);
    return this.reconstructTrades(fills);
  }

  async collectFills(limit = AnalyticsDataCollectorService.MAX_FILLS): Promise<AnalyticsFill[]> {
    const fills = await this.store.loadFills(limit);
    return fills.map((f) => this.toAnalyticsFill(f));
  }

  async collectEquityPoints(): Promise<AnalyticsEquityPoint[]> {
    const records = await this.store.loadDailyRecords(400);
    if (records.length === 0) return [];

    const points: AnalyticsEquityPoint[] = [];
    let startEquity = records[0]?.openEquity ?? 0;
    if (startEquity <= 0) startEquity = records[0]?.closeEquity ?? 1;

    for (let i = 0; i < records.length; i++) {
      const rec = records[i]!;
      const prevEquity = i === 0 ? startEquity : records[i - 1]!.closeEquity;
      const dailyReturn = prevEquity > 0 ? (rec.closeEquity - prevEquity) / prevEquity : 0;
      const cumulativeReturn = startEquity > 0 ? (rec.closeEquity - startEquity) / startEquity : 0;

      points.push({
        timestamp: new Date(rec.date).getTime(),
        date: rec.date,
        equity: rec.closeEquity,
        cashBalance: rec.closeEquity - rec.unrealizedPnl,
        dailyReturn,
        cumulativeReturn,
      });
    }

    return points;
  }

  async collectPositionSnapshots(): Promise<AnalyticsPositionSnapshot[]> {
    const positions = this.portfolio.getOpenPositions();
    return positions
      .filter((p) => p.direction !== 'FLAT')
      .map((p) => ({
        positionId: p.positionId,
        strategyId: p.strategyId,
        symbol: p.symbol,
        exchangeId: AnalyticsDataCollectorService.PAPER_EXCHANGE_ID,
        direction: p.direction as 'LONG' | 'SHORT',
        quantity: p.quantity,
        averageEntryPrice: p.averageEntryPrice,
        notional: p.quantity * p.averageEntryPrice,
        unrealizedPnl: p.unrealizedPnl,
      }));
  }

  async collectDailyCapitalRecords(): Promise<DailyCapitalRecord[]> {
    const records = await this.store.loadDailyRecords(400);
    return records.map((r) => ({
      date: r.date,
      timestamp: new Date(r.date).getTime(),
      equity: r.closeEquity,
      cashBalance: r.closeEquity - r.unrealizedPnl,
      unrealizedPnl: r.unrealizedPnl,
    }));
  }

  getCurrentAccountState(): PaperAccountState {
    return this.account.getState();
  }

  async getTotalFillCount(): Promise<number> {
    return this.store.countFills();
  }

  // ── Trade reconstruction ─────────────────────────────────────────────────────

  private reconstructTrades(fills: PaperFillRecord[]): AnalyticsTrade[] {
    // Sort fills chronologically
    const sorted = [...fills].sort((a, b) => a.filledAt - b.filledAt);

    // Per-key position tracker: key = `${strategyId}:${symbol}`
    interface PositionState {
      side: 'LONG' | 'SHORT';
      quantity: number;
      avgEntryPrice: number;
      entryTime: number;
      totalEntryNotional: number;
      totalSlippage: number;
      totalCommission: number;
    }

    const positions = new Map<string, PositionState>();
    const trades: AnalyticsTrade[] = [];
    let tradeCounter = 0;

    for (const fill of sorted) {
      const key = `${fill.strategyId}:${fill.symbol}`;
      const existing = positions.get(key);

      // Determine if this fill opens or closes a position
      const isLongOpen = fill.side === 'BUY';
      const isShortOpen = fill.side === 'SELL';

      if (!existing) {
        // New position
        const direction: 'LONG' | 'SHORT' = isLongOpen ? 'LONG' : 'SHORT';
        positions.set(key, {
          side: direction,
          quantity: fill.filledQuantity,
          avgEntryPrice: fill.fillPrice,
          entryTime: fill.filledAt,
          totalEntryNotional: fill.notional,
          totalSlippage: Math.abs(fill.slippage),
          totalCommission: fill.commission,
        });
      } else if (
        (existing.side === 'LONG' && isLongOpen) ||
        (existing.side === 'SHORT' && isShortOpen)
      ) {
        // Adding to existing position → update weighted avg entry price
        const newQty = existing.quantity + fill.filledQuantity;
        const newNotional = existing.totalEntryNotional + fill.notional;
        positions.set(key, {
          ...existing,
          quantity: newQty,
          avgEntryPrice: newNotional / newQty,
          totalEntryNotional: newNotional,
          totalSlippage: existing.totalSlippage + Math.abs(fill.slippage),
          totalCommission: existing.totalCommission + fill.commission,
        });
      } else {
        // Closing fill (opposite side)
        const closedQty = Math.min(fill.filledQuantity, existing.quantity);
        const exitPrice = fill.fillPrice;
        const entryPrice = existing.avgEntryPrice;
        const grossPnl =
          existing.side === 'LONG'
            ? (exitPrice - entryPrice) * closedQty
            : (entryPrice - exitPrice) * closedQty;
        const commission = existing.totalCommission + fill.commission;
        const netPnl = grossPnl - commission;

        trades.push({
          tradeId: `trade_${fill.strategyId}_${++tradeCounter}`,
          strategyId: fill.strategyId,
          symbol: fill.symbol,
          exchangeId: AnalyticsDataCollectorService.PAPER_EXCHANGE_ID,
          side: existing.side,
          entryTime: existing.entryTime,
          exitTime: fill.filledAt,
          entryPrice,
          exitPrice,
          quantity: closedQty,
          grossPnl,
          commission,
          netPnl,
          slippage: existing.totalSlippage + Math.abs(fill.slippage),
          durationMs: Math.max(fill.filledAt - existing.entryTime, 0),
        });

        const remainingQty = existing.quantity - closedQty;
        if (remainingQty <= 0) {
          positions.delete(key);
        } else {
          positions.set(key, { ...existing, quantity: remainingQty });
        }
      }
    }

    return trades;
  }

  // ── Mapping helpers ──────────────────────────────────────────────────────────

  private toAnalyticsFill(fill: PaperFillRecord): AnalyticsFill {
    return {
      fillId: fill.fillId,
      orderId: fill.orderId,
      strategyId: fill.strategyId,
      symbol: fill.symbol,
      exchangeId: AnalyticsDataCollectorService.PAPER_EXCHANGE_ID,
      side: fill.side,
      filledQuantity: fill.filledQuantity,
      fillPrice: fill.fillPrice,
      notional: fill.notional,
      commission: fill.commission,
      slippage: fill.slippage,
      realizedPnl: fill.realizedPnl,
      filledAt: fill.filledAt,
      // latencyMs not available in paper trading fills
    };
  }
}
