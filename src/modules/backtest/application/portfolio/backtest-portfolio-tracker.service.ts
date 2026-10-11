import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { OrderSide } from '@modules/exchange/enums/order.enums';
import { TradeRecord } from '../../domain/models/trade-record.model';
import { SimulatedFill } from '../execution-simulator/fill-model';

interface BacktestPosition {
  positionId: string;
  symbol: string;
  strategyId: string;
  side: OrderSide;
  quantity: number;
  entryPrice: number;
  entryTime: number;
  entryOrderId: string;
  peakAdverseExcursion: number;
  peakFavorableExcursion: number;
  totalCommission: number;
}

export interface BacktestPortfolioState {
  cash: number;
  equity: number;
  unrealizedPnl: number;
  openPositions: Map<string, BacktestPosition>;
  completedTrades: TradeRecord[];
  totalCommission: number;
  totalSlippage: number;
  dailyRealizedPnl: number;
  lastDayReset: number;
}

@Injectable()
export class BacktestPortfolioTrackerService {
  private cash = 0;
  private readonly openPositions = new Map<string, BacktestPosition>();
  private readonly completedTrades: TradeRecord[] = [];
  private totalCommission = 0;
  private totalSlippage = 0;
  private dailyRealizedPnl = 0;
  private lastDayReset = 0;
  private currentMarkPrices = new Map<string, number>();

  initialize(initialCapitalUsd: number): void {
    this.cash = initialCapitalUsd;
    this.openPositions.clear();
    this.completedTrades.length = 0;
    this.totalCommission = 0;
    this.totalSlippage = 0;
    this.dailyRealizedPnl = 0;
    this.lastDayReset = 0;
    this.currentMarkPrices.clear();
  }

  applyFill(fill: SimulatedFill): void {
    this.totalCommission += fill.commission;
    this.totalSlippage += fill.slippage;

    const positionKey = `${fill.order.strategyId}:${fill.order.symbol}`;
    const existing = this.openPositions.get(positionKey);

    if (fill.order.side === OrderSide.BUY) {
      const cost = fill.filledQuantity * fill.fillPrice + fill.commission;
      this.cash -= cost;

      if (!existing) {
        this.openPositions.set(positionKey, {
          positionId: randomUUID(),
          symbol: fill.order.symbol,
          strategyId: fill.order.strategyId,
          side: OrderSide.BUY,
          quantity: fill.filledQuantity,
          entryPrice: fill.fillPrice,
          entryTime: fill.fillTime,
          entryOrderId: fill.order.orderId,
          peakAdverseExcursion: 0,
          peakFavorableExcursion: 0,
          totalCommission: fill.commission,
        });
      } else if (existing.side === OrderSide.BUY) {
        const totalQty = existing.quantity + fill.filledQuantity;
        const avgEntry =
          (existing.entryPrice * existing.quantity + fill.fillPrice * fill.filledQuantity) /
          totalQty;
        existing.quantity = totalQty;
        existing.entryPrice = avgEntry;
        existing.totalCommission += fill.commission;
      } else {
        this.closeOrReducePosition(existing, fill, positionKey);
      }
    } else {
      const proceeds = fill.filledQuantity * fill.fillPrice - fill.commission;
      this.cash += proceeds;

      if (!existing) {
        this.openPositions.set(positionKey, {
          positionId: randomUUID(),
          symbol: fill.order.symbol,
          strategyId: fill.order.strategyId,
          side: OrderSide.SELL,
          quantity: fill.filledQuantity,
          entryPrice: fill.fillPrice,
          entryTime: fill.fillTime,
          entryOrderId: fill.order.orderId,
          peakAdverseExcursion: 0,
          peakFavorableExcursion: 0,
          totalCommission: fill.commission,
        });
      } else if (existing.side === OrderSide.SELL) {
        const totalQty = existing.quantity + fill.filledQuantity;
        const avgEntry =
          (existing.entryPrice * existing.quantity + fill.fillPrice * fill.filledQuantity) /
          totalQty;
        existing.quantity = totalQty;
        existing.entryPrice = avgEntry;
        existing.totalCommission += fill.commission;
      } else {
        this.closeOrReducePosition(existing, fill, positionKey);
      }
    }

    this.checkDayReset(fill.fillTime);
  }

  private closeOrReducePosition(
    existing: BacktestPosition,
    fill: SimulatedFill,
    key: string,
  ): void {
    const closedQty = Math.min(existing.quantity, fill.filledQuantity);
    const pnlPerUnit =
      existing.side === OrderSide.BUY
        ? fill.fillPrice - existing.entryPrice
        : existing.entryPrice - fill.fillPrice;
    const grossPnl = pnlPerUnit * closedQty;
    const commission = fill.commission;
    const netPnl = grossPnl - commission;

    this.dailyRealizedPnl += netPnl;

    const markPrice = this.currentMarkPrices.get(existing.symbol) ?? fill.fillPrice;
    const maePrice =
      existing.side === OrderSide.BUY
        ? Math.min(existing.entryPrice, markPrice)
        : Math.max(existing.entryPrice, markPrice);
    const mfePrice =
      existing.side === OrderSide.BUY
        ? Math.max(existing.entryPrice, markPrice)
        : Math.min(existing.entryPrice, markPrice);
    const maePercent = Math.abs((maePrice - existing.entryPrice) / existing.entryPrice) * 100;
    const mfePercent = Math.abs((mfePrice - existing.entryPrice) / existing.entryPrice) * 100;

    const trade: TradeRecord = {
      tradeId: randomUUID(),
      strategyId: existing.strategyId,
      symbol: existing.symbol,
      side: existing.side,
      entryTime: existing.entryTime,
      exitTime: fill.fillTime,
      entryPrice: existing.entryPrice,
      exitPrice: fill.fillPrice,
      quantity: closedQty,
      grossPnl,
      commission: existing.totalCommission + commission,
      netPnl: grossPnl - existing.totalCommission - commission,
      durationMs: fill.fillTime - existing.entryTime,
      maePercent,
      mfePercent,
      entryOrderId: existing.entryOrderId,
      exitOrderId: fill.order.orderId,
    };

    this.completedTrades.push(trade);

    if (fill.filledQuantity >= existing.quantity) {
      this.openPositions.delete(key);
    } else {
      existing.quantity -= closedQty;
    }
  }

  updateMarkPrice(symbol: string, price: number, _currentTime: number): void {
    this.currentMarkPrices.set(symbol, price);

    for (const pos of this.openPositions.values()) {
      if (pos.symbol !== symbol) continue;

      const pnlPerUnit =
        pos.side === OrderSide.BUY ? price - pos.entryPrice : pos.entryPrice - price;

      const pnlPercent = (pnlPerUnit / pos.entryPrice) * 100;

      if (pnlPercent < 0 && Math.abs(pnlPercent) > pos.peakAdverseExcursion) {
        pos.peakAdverseExcursion = Math.abs(pnlPercent);
      }
      if (pnlPercent > 0 && pnlPercent > pos.peakFavorableExcursion) {
        pos.peakFavorableExcursion = pnlPercent;
      }
    }
  }

  getUnrealizedPnl(): number {
    let total = 0;
    for (const pos of this.openPositions.values()) {
      const markPrice = this.currentMarkPrices.get(pos.symbol) ?? pos.entryPrice;
      const pnl =
        pos.side === OrderSide.BUY
          ? (markPrice - pos.entryPrice) * pos.quantity
          : (pos.entryPrice - markPrice) * pos.quantity;
      total += pnl;
    }
    return total;
  }

  getEquity(): number {
    let positionNetValue = 0;
    for (const pos of this.openPositions.values()) {
      const markPrice = this.currentMarkPrices.get(pos.symbol) ?? pos.entryPrice;
      positionNetValue +=
        pos.side === OrderSide.BUY ? pos.quantity * markPrice : -pos.quantity * markPrice;
    }
    return this.cash + positionNetValue;
  }

  getCash(): number {
    return this.cash;
  }

  getDailyRealizedPnl(): number {
    return this.dailyRealizedPnl;
  }

  getCompletedTrades(): TradeRecord[] {
    return [...this.completedTrades];
  }

  getOpenPositions(): BacktestPosition[] {
    return [...this.openPositions.values()];
  }

  getTotalCommission(): number {
    return this.totalCommission;
  }

  getTotalSlippage(): number {
    return this.totalSlippage;
  }

  getExposureUsd(): number {
    let total = 0;
    for (const pos of this.openPositions.values()) {
      const markPrice = this.currentMarkPrices.get(pos.symbol) ?? pos.entryPrice;
      total += pos.quantity * markPrice;
    }
    return total;
  }

  getState(): BacktestPortfolioState {
    return {
      cash: this.cash,
      equity: this.getEquity(),
      unrealizedPnl: this.getUnrealizedPnl(),
      openPositions: new Map(this.openPositions),
      completedTrades: [...this.completedTrades],
      totalCommission: this.totalCommission,
      totalSlippage: this.totalSlippage,
      dailyRealizedPnl: this.dailyRealizedPnl,
      lastDayReset: this.lastDayReset,
    };
  }

  private checkDayReset(currentTime: number): void {
    const currentDay = Math.floor(currentTime / 86_400_000);
    const lastDay = Math.floor(this.lastDayReset / 86_400_000);
    if (currentDay > lastDay) {
      this.dailyRealizedPnl = 0;
      this.lastDayReset = currentTime;
    }
  }
}
