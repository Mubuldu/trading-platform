import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaperTradingConfig } from '@config/paper-trading.config';
import { PaperDailyRecord } from '../../domain/models/paper-account-state.model';
import { PaperStateStoreService } from '../../infrastructure/store/paper-state-store.service';
import { PaperPortfolioManagerService } from './paper-portfolio-manager.service';
import { PaperAccountService } from './paper-account.service';

export interface PeriodStats {
  readonly startDate: string;
  readonly endDate: string;
  readonly openEquity: number;
  readonly closeEquity: number;
  readonly netPnl: number;
  readonly returnPercent: number;
  readonly fees: number;
  readonly funding: number;
  readonly tradeCount: number;
  readonly winDays: number;
  readonly lossDays: number;
  readonly maxDailyGain: number;
  readonly maxDailyLoss: number;
  readonly avgDailyReturn: number;
}

export interface DrawdownReport {
  readonly currentDrawdown: number;
  readonly maxDrawdown: number;
  readonly peakEquity: number;
  readonly currentEquity: number;
  readonly maxDrawdownStartDate: string;
  readonly maxDrawdownEndDate: string;
}

export interface ExposureReport {
  readonly totalGrossExposure: number;
  readonly totalNetExposure: number;
  readonly bySymbol: Record<
    string,
    { direction: string; quantity: number; notional: number; unrealizedPnl: number }
  >;
  readonly longCount: number;
  readonly shortCount: number;
  readonly snapshotAt: number;
}

export interface TradeHistoryEntry {
  readonly fillId: string;
  readonly symbol: string;
  readonly side: string;
  readonly orderType: string;
  readonly quantity: number;
  readonly fillPrice: number;
  readonly notional: number;
  readonly commission: number;
  readonly slippage: number;
  readonly isMaker: boolean;
  readonly filledAt: number;
}

/**
 * A reconstructed round-trip trade: one BUY open + one (or more) SELL close,
 * matched FIFO per (strategyId, symbol).
 */
export interface ReconstructedTrade {
  readonly tradeId: string;
  readonly strategyId: string;
  readonly symbol: string;
  /** Direction of the position that was opened. */
  readonly side: 'LONG' | 'SHORT';
  readonly quantity: number;
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly entryTime: number;
  readonly exitTime: number;
  /** Gross P&L before commissions. */
  readonly grossPnl: number;
  /** Total commissions paid (entry + exit). */
  readonly commission: number;
  /** Net P&L after commissions. */
  readonly netPnl: number;
  readonly slippage: number;
  /** How long the trade was held, in milliseconds. */
  readonly durationMs: number;
  /** true = net winner, false = net loser, null = breakeven. */
  readonly isWin: boolean | null;
}

export interface PaperPnlReport {
  readonly daily: PeriodStats;
  readonly weekly: PeriodStats;
  readonly monthly: PeriodStats;
  readonly allTime: PeriodStats;
  readonly drawdown: DrawdownReport;
  readonly exposure: ExposureReport;
  readonly computedAt: number;
}

/**
 * PaperReportService generates human-readable PnL and performance reports
 * for the paper trading session.
 *
 * All data is read from Redis via PaperStateStoreService — no DB required.
 * Reports are computed on demand (not cached) so they always reflect the
 * latest state.
 *
 * Reports:
 *   daily   — today's PnL (live calendar day)
 *   weekly  — last 7 calendar days
 *   monthly — last 30 calendar days
 *   allTime — full session history
 *   drawdown — current and maximum drawdown
 *   exposure  — open position exposure breakdown
 *   tradeHistory — paginated fill records
 */
@Injectable()
export class PaperReportService {
  private readonly cfg: PaperTradingConfig;

  constructor(
    configService: ConfigService,
    private readonly store: PaperStateStoreService,
    private readonly portfolio: PaperPortfolioManagerService,
    private readonly account: PaperAccountService,
  ) {
    this.cfg = configService.get<PaperTradingConfig>('paperTrading')!;
  }

  // ── Full report ──────────────────────────────────────────────────────────────

  async getFullReport(): Promise<PaperPnlReport> {
    const [daily, weekly, monthly, allTime, drawdown, exposure] = await Promise.all([
      this.getDailyReport(),
      this.getPeriodReport(7),
      this.getPeriodReport(30),
      this.getAllTimeReport(),
      this.getDrawdownReport(),
      this.getExposureReport(),
    ]);

    return { daily, weekly, monthly, allTime, drawdown, exposure, computedAt: Date.now() };
  }

  // ── Period reports ───────────────────────────────────────────────────────────

  async getDailyReport(): Promise<PeriodStats> {
    const today = new Date().toISOString().slice(0, 10);
    const records = await this.store.loadDailyRecords(1);
    const todayRecord = records.find((r) => r.date === today);

    if (!todayRecord) {
      const equity = this.account.getState().equity;
      return this.emptyPeriodStats(today, today, equity);
    }

    return this.recordToPeriodStats([todayRecord]);
  }

  async getWeeklyReport(): Promise<PeriodStats> {
    return this.getPeriodReport(7);
  }

  async getMonthlyReport(): Promise<PeriodStats> {
    return this.getPeriodReport(30);
  }

  async getAllTimeReport(): Promise<PeriodStats> {
    const records = await this.store.loadDailyRecords(400);
    return this.recordToPeriodStats(records);
  }

  private async getPeriodReport(days: number): Promise<PeriodStats> {
    const records = await this.store.loadDailyRecords(days);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const sliced = records.filter((r) => r.date >= cutoffStr);
    return this.recordToPeriodStats(sliced);
  }

  // ── Drawdown ─────────────────────────────────────────────────────────────────

  async getDrawdownReport(): Promise<DrawdownReport> {
    const records = await this.store.loadDailyRecords(400);
    const { equity, peakEquity } = this.account.getState();

    let maxDrawdown = 0;
    let maxDrawdownStartDate = '';
    let maxDrawdownEndDate = '';
    let peak = this.cfg.initialBalanceUsd;

    for (const r of records) {
      if (r.closeEquity > peak) {
        peak = r.closeEquity;
      }
      const dd = peak > 0 ? (peak - r.closeEquity) / peak : 0;
      if (dd > maxDrawdown) {
        maxDrawdown = dd;
        maxDrawdownEndDate = r.date;
      }
    }

    // Find start date of max drawdown (last date equity was at peak before the max loss)
    for (const r of records) {
      if (r.date < maxDrawdownEndDate && r.closeEquity >= peak * (1 - 0.001)) {
        maxDrawdownStartDate = r.date;
      }
    }

    return {
      currentDrawdown: this.portfolio.getCurrentDrawdown(),
      maxDrawdown,
      peakEquity,
      currentEquity: equity,
      maxDrawdownStartDate: maxDrawdownStartDate || (records[0]?.date ?? ''),
      maxDrawdownEndDate: maxDrawdownEndDate || '',
    };
  }

  // ── Exposure ─────────────────────────────────────────────────────────────────

  async getExposureReport(): Promise<ExposureReport> {
    const positions = this.portfolio.getOpenPositions();
    const bySymbol: ExposureReport['bySymbol'] = {};
    let grossLong = 0;
    let grossShort = 0;
    let longCount = 0;
    let shortCount = 0;

    for (const pos of positions) {
      const notional = pos.quantity * pos.averageEntryPrice;
      bySymbol[pos.symbol] = {
        direction: pos.direction,
        quantity: pos.quantity,
        notional,
        unrealizedPnl: pos.unrealizedPnl,
      };

      if (pos.direction === 'LONG') {
        grossLong += notional;
        longCount++;
      } else {
        grossShort += notional;
        shortCount++;
      }
    }

    return {
      totalGrossExposure: grossLong + grossShort,
      totalNetExposure: grossLong - grossShort,
      bySymbol,
      longCount,
      shortCount,
      snapshotAt: Date.now(),
    };
  }

  // ── Trade history ────────────────────────────────────────────────────────────

  async getTradeHistory(limit = 100): Promise<TradeHistoryEntry[]> {
    const fills = await this.store.loadFills(limit);
    return fills.map((f) => ({
      fillId: f.fillId,
      symbol: f.symbol,
      side: f.side,
      orderType: f.orderType,
      quantity: f.filledQuantity,
      fillPrice: f.fillPrice,
      notional: f.notional,
      commission: f.commission,
      slippage: f.slippage,
      isMaker: f.isMaker,
      filledAt: f.filledAt,
    }));
  }

  async getTotalTradeCount(): Promise<number> {
    return this.store.countFills();
  }

  /**
   * Reconstruct round-trip trades from raw fill records using FIFO average-cost.
   *
   * Each BUY fill opens (or adds to) a virtual position; each SELL fill closes
   * (or reduces) it. When the position reaches zero quantity a complete trade
   * is emitted with entry price, exit price, gross/net P&L, commissions, and
   * hold duration.
   *
   * @param limit - max number of fills to scan (default 2 000, plenty for history)
   */
  async getReconstructedTrades(limit = 2_000): Promise<ReconstructedTrade[]> {
    const fills = await this.store.loadFills(limit);

    // Sort fills chronologically (store returns newest-first)
    const sorted = [...fills].sort((a, b) => a.filledAt - b.filledAt);

    interface OpenPosition {
      side: 'LONG' | 'SHORT';
      strategyId: string;
      quantity: number;
      avgEntryPrice: number;
      entryTime: number;
      totalEntryNotional: number;
      totalSlippage: number;
      totalCommission: number;
    }

    const positions = new Map<string, OpenPosition>();
    const trades: ReconstructedTrade[] = [];
    let counter = 0;

    for (const fill of sorted) {
      const key = `${fill.strategyId}:${fill.symbol}`;
      const existing = positions.get(key);
      const isLong = fill.side === 'BUY';

      if (!existing) {
        // Opening a new position
        positions.set(key, {
          side: isLong ? 'LONG' : 'SHORT',
          strategyId: fill.strategyId,
          quantity: fill.filledQuantity,
          avgEntryPrice: fill.fillPrice,
          entryTime: fill.filledAt,
          totalEntryNotional: fill.notional,
          totalSlippage: Math.abs(fill.slippage),
          totalCommission: fill.commission,
        });
      } else if (
        (existing.side === 'LONG' && isLong) ||
        (existing.side === 'SHORT' && !isLong)
      ) {
        // Adding to existing position — update weighted average entry
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
        // Closing fill — opposite side
        const closedQty = Math.min(fill.filledQuantity, existing.quantity);
        const entryPrice = existing.avgEntryPrice;
        const exitPrice = fill.fillPrice;
        const grossPnl =
          existing.side === 'LONG'
            ? (exitPrice - entryPrice) * closedQty
            : (entryPrice - exitPrice) * closedQty;
        const commission = existing.totalCommission + fill.commission;
        const netPnl = grossPnl - commission;
        const slippage = existing.totalSlippage + Math.abs(fill.slippage);
        const durationMs = Math.max(fill.filledAt - existing.entryTime, 0);

        trades.push({
          tradeId: `trade_${fill.strategyId}_${++counter}`,
          strategyId: fill.strategyId,
          symbol: fill.symbol,
          side: existing.side,
          quantity: closedQty,
          entryPrice,
          exitPrice,
          entryTime: existing.entryTime,
          exitTime: fill.filledAt,
          grossPnl,
          commission,
          netPnl,
          slippage,
          durationMs,
          isWin: netPnl > 0 ? true : netPnl < 0 ? false : null,
        });

        const remainingQty = existing.quantity - closedQty;
        if (remainingQty <= 0) {
          positions.delete(key);
          // Reversal: the fill exceeded the existing position — the surplus opens a
          // new opposite-side position in the same fill.  Without this, a single
          // reversal fill (e.g. BUY that closes a SHORT and opens a LONG) would
          // silently discard the new LONG, causing its eventual close fill to be
          // misclassified as a fresh SHORT open.
          const reversalQty = fill.filledQuantity - closedQty;
          if (reversalQty > 0) {
            const reversedSide: 'LONG' | 'SHORT' = isLong ? 'LONG' : 'SHORT';
            // Commission is already charged in full on the reversal fill; split it
            // proportionally — the closing portion is attributed to the trade above
            // and the opening portion seeds the new position.
            const closingFrac = closedQty / fill.filledQuantity;
            const openingFrac = 1 - closingFrac;
            positions.set(key, {
              side: reversedSide,
              strategyId: fill.strategyId,
              quantity: reversalQty,
              avgEntryPrice: fill.fillPrice,
              entryTime: fill.filledAt,
              totalEntryNotional: fill.fillPrice * reversalQty,
              totalSlippage: Math.abs(fill.slippage) * openingFrac,
              totalCommission: fill.commission * openingFrac,
            });
          }
        } else {
          positions.set(key, { ...existing, quantity: remainingQty });
        }
      }
    }

    // Return newest-first
    return trades.reverse();
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private recordToPeriodStats(records: PaperDailyRecord[]): PeriodStats {
    if (records.length === 0) {
      const equity = this.account.getState().equity;
      const today = new Date().toISOString().slice(0, 10);
      return this.emptyPeriodStats(today, today, equity);
    }

    const startDate = records[0].date;
    const endDate = records[records.length - 1].date;
    const openEquity = records[0].openEquity;
    const closeEquity = records[records.length - 1].closeEquity;

    const netPnl = records.reduce((s, r) => s + r.netPnl, 0);
    const fees = records.reduce((s, r) => s + r.fees, 0);
    const funding = records.reduce((s, r) => s + r.funding, 0);
    const tradeCount = records.reduce((s, r) => s + r.tradeCount, 0);
    const winDays = records.filter((r) => r.netPnl > 0).length;
    const lossDays = records.filter((r) => r.netPnl < 0).length;
    const returns = records.map((r) => r.returnPercent);
    const maxDailyGain = returns.length > 0 ? Math.max(...returns) : 0;
    const maxDailyLoss = returns.length > 0 ? Math.min(...returns) : 0;
    const avgDailyReturn =
      returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const returnPercent = openEquity > 0 ? (netPnl / openEquity) * 100 : 0;

    return {
      startDate,
      endDate,
      openEquity,
      closeEquity,
      netPnl,
      returnPercent,
      fees,
      funding,
      tradeCount,
      winDays,
      lossDays,
      maxDailyGain,
      maxDailyLoss,
      avgDailyReturn,
    };
  }

  private emptyPeriodStats(startDate: string, endDate: string, equity: number): PeriodStats {
    return {
      startDate,
      endDate,
      openEquity: equity,
      closeEquity: equity,
      netPnl: 0,
      returnPercent: 0,
      fees: 0,
      funding: 0,
      tradeCount: 0,
      winDays: 0,
      lossDays: 0,
      maxDailyGain: 0,
      maxDailyLoss: 0,
      avgDailyReturn: 0,
    };
  }
}
