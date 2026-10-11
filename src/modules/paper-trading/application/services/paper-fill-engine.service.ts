import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PaperTradingConfig } from '@config/paper-trading.config';
import { OrderSide, OrderType } from '@modules/exchange/enums/order.enums';
import { NormalizedSymbol } from '@modules/exchange/models/common.model';
import { PaperFillRecord } from '../../domain/models/paper-account-state.model';
import { PaperOpenOrder } from '../../domain/models/paper-open-order.model';
import { PaperOrderState } from '../../domain/enums/paper-order-state.enum';

export interface CurrentPrice {
  readonly symbol: NormalizedSymbol;
  readonly bestBid: number;
  readonly bestAsk: number;
  readonly midPrice: number;
  readonly lastPrice: number;
}

export interface FillResult {
  readonly fill: PaperFillRecord;
  readonly updatedOrder: PaperOpenOrder;
  readonly fillPrice: number;
  readonly isMaker: boolean;
  readonly isPartial: boolean;
}

/**
 * PaperFillEngineService is the simulation core.
 *
 * It applies slippage, commission, and volume-based partial-fill logic to
 * produce realistic-looking PaperFillRecords from pending orders and live
 * prices. It does NOT manage state — callers own the order and account objects.
 *
 * Fill rules (mirroring backtest conventions):
 *   MARKET       — fills at best ask (BUY) or best bid (SELL) ± slippage
 *   LIMIT BUY    — fills at limitPrice when bestAsk ≤ limitPrice (maker)
 *   LIMIT SELL   — fills at limitPrice when bestBid ≥ limitPrice (maker)
 *   STOP BUY     — triggers when bestAsk ≥ stopPrice, fills as market
 *   STOP SELL    — triggers when bestBid ≤ stopPrice, fills as market
 *   TRAILING STOP — dynamic stop follows price; fills as market on trigger
 *
 * Partial fills: when partialFillEnabled, random 30–100% of remaining qty
 * is filled on each tick trigger for limit orders, simulating real order-book
 * liquidity absorption.
 */
@Injectable()
export class PaperFillEngineService {
  private readonly cfg: PaperTradingConfig;

  constructor(configService: ConfigService) {
    this.cfg = configService.get<PaperTradingConfig>('paperTrading')!;
  }

  // ── Price derivation ─────────────────────────────────────────────────────────

  marketFillPrice(price: CurrentPrice, side: OrderSide): number {
    const base = side === OrderSide.BUY ? price.bestAsk : price.bestBid;
    return this.applySlippage(base, side);
  }

  private applySlippage(price: number, side: OrderSide): number {
    if (!this.cfg.simulateSlippage || this.cfg.slippageBps === 0) return price;
    const factor = this.cfg.slippageBps / 10_000;
    return side === OrderSide.BUY ? price * (1 + factor) : price * (1 - factor);
  }

  // ── Commission ───────────────────────────────────────────────────────────────

  commission(notional: number, isMaker: boolean): number {
    const bps = isMaker ? this.cfg.makerCommissionBps : this.cfg.takerCommissionBps;
    return notional * (bps / 10_000);
  }

  // ── Market order fill ─────────────────────────────────────────────────────────

  fillMarketOrder(
    order: PaperOpenOrder,
    price: CurrentPrice,
    decisionId: string,
    requestId: string,
  ): FillResult {
    const fillPrice = this.marketFillPrice(price, order.side);
    const qty = this.partialFillQty(order.remainingQuantity, false);
    const notional = qty * fillPrice;
    const comm = this.commission(notional, false /* taker */);
    const isPartial = qty < order.remainingQuantity;

    const fill: PaperFillRecord = {
      fillId: randomUUID(),
      orderId: order.orderId,
      requestId,
      decisionId,
      strategyId: order.strategyId,
      symbol: order.symbol,
      side: order.side,
      orderType: order.type,
      isMaker: false,
      filledQuantity: qty,
      fillPrice,
      notional,
      commission: comm,
      slippage: this.slippageAmount(price, order.side, fillPrice, qty),
      realizedPnl: 0, // computed by position manager
      filledAt: Date.now(),
    };

    const updatedOrder: PaperOpenOrder = {
      ...order,
      filledQuantity: order.filledQuantity + qty,
      remainingQuantity: order.remainingQuantity - qty,
      state: isPartial ? PaperOrderState.PARTIALLY_FILLED : PaperOrderState.FILLED,
      updatedAt: Date.now(),
    };

    return { fill, updatedOrder, fillPrice, isMaker: false, isPartial };
  }

  // ── Limit order fill (triggered when price crosses the limit) ────────────────

  tryFillLimitOrder(
    order: PaperOpenOrder,
    price: CurrentPrice,
    decisionId: string,
    requestId: string,
  ): FillResult | null {
    if (!order.limitPrice) return null;
    const limitPrice = order.limitPrice;

    // BUY limit fills when the ask comes down to or below limit
    // SELL limit fills when the bid rises to or above limit
    const triggered =
      (order.side === OrderSide.BUY && price.bestAsk <= limitPrice) ||
      (order.side === OrderSide.SELL && price.bestBid >= limitPrice);

    if (!triggered) return null;

    const fillPrice = limitPrice; // maker fills at limit price exactly
    const qty = this.partialFillQty(order.remainingQuantity, true);
    const notional = qty * fillPrice;
    const comm = this.commission(notional, true /* maker */);
    const isPartial = qty < order.remainingQuantity;

    const fill: PaperFillRecord = {
      fillId: randomUUID(),
      orderId: order.orderId,
      requestId,
      decisionId,
      strategyId: order.strategyId,
      symbol: order.symbol,
      side: order.side,
      orderType: order.type,
      isMaker: true,
      filledQuantity: qty,
      fillPrice,
      notional,
      commission: comm,
      slippage: 0, // maker fills at limit price — no slippage
      realizedPnl: 0,
      filledAt: Date.now(),
    };

    const updatedOrder: PaperOpenOrder = {
      ...order,
      filledQuantity: order.filledQuantity + qty,
      remainingQuantity: order.remainingQuantity - qty,
      state: isPartial ? PaperOrderState.PARTIALLY_FILLED : PaperOrderState.FILLED,
      updatedAt: Date.now(),
    };

    return { fill, updatedOrder, fillPrice, isMaker: true, isPartial };
  }

  // ── Stop order fill (triggered when price crosses the stop) ──────────────────

  tryFillStopOrder(
    order: PaperOpenOrder,
    price: CurrentPrice,
    decisionId: string,
    requestId: string,
  ): FillResult | null {
    if (!order.stopPrice) return null;
    const stopPrice = order.stopPrice;

    const triggered =
      (order.side === OrderSide.BUY && price.bestAsk >= stopPrice) ||
      (order.side === OrderSide.SELL && price.bestBid <= stopPrice);

    if (!triggered) return null;

    // For STOP_LIMIT: only fill if the limit price constraint is still satisfiable
    if (order.type === OrderType.STOP_LIMIT && order.limitPrice) {
      if (order.side === OrderSide.BUY && price.bestAsk > order.limitPrice) return null;
      if (order.side === OrderSide.SELL && price.bestBid < order.limitPrice) return null;
    }

    // Fills as a taker market order from the stop trigger price
    const rawPrice =
      order.type === OrderType.STOP_LIMIT && order.limitPrice ? order.limitPrice : stopPrice;
    const fillPrice = this.applySlippage(rawPrice, order.side);
    const qty = order.remainingQuantity; // stop orders fill in full
    const notional = qty * fillPrice;
    const comm = this.commission(notional, false /* taker */);

    const fill: PaperFillRecord = {
      fillId: randomUUID(),
      orderId: order.orderId,
      requestId,
      decisionId,
      strategyId: order.strategyId,
      symbol: order.symbol,
      side: order.side,
      orderType: order.type,
      isMaker: false,
      filledQuantity: qty,
      fillPrice,
      notional,
      commission: comm,
      slippage: this.slippageAmount(price, order.side, fillPrice, qty),
      realizedPnl: 0,
      filledAt: Date.now(),
    };

    const updatedOrder: PaperOpenOrder = {
      ...order,
      filledQuantity: order.filledQuantity + qty,
      remainingQuantity: 0,
      state: PaperOrderState.FILLED,
      updatedAt: Date.now(),
    };

    return { fill, updatedOrder, fillPrice, isMaker: false, isPartial: false };
  }

  // ── Trailing stop fill ───────────────────────────────────────────────────────

  /**
   * Updates trailing stop prices on each tick and returns a fill if triggered.
   * Mutates trailPeakPrice and trailStopPrice on the order in-place (caller
   * must persist the updated order back to the store).
   */
  tryFillTrailingStopOrder(
    order: PaperOpenOrder,
    price: CurrentPrice,
    decisionId: string,
    requestId: string,
  ): FillResult | null {
    if (!order.trailingDeltaBps) return null;
    const deltaFactor = order.trailingDeltaBps / 10_000;

    if (order.side === OrderSide.SELL) {
      // Trail behind the high — stop triggers on a drop
      const newPeak =
        order.trailPeakPrice != null
          ? Math.max(order.trailPeakPrice, price.lastPrice)
          : price.lastPrice;
      const newStop = newPeak * (1 - deltaFactor);

      // Mutate the order's trail state
      (order as { trailPeakPrice: number }).trailPeakPrice = newPeak;
      (order as { trailStopPrice: number }).trailStopPrice = newStop;

      if (price.bestBid <= newStop) {
        return this.buildTrailingFill(order, price, newStop, decisionId, requestId);
      }
    } else {
      // BUY trailing stop — trail behind the low, triggers on a rise
      const newTrough =
        order.trailPeakPrice != null
          ? Math.min(order.trailPeakPrice, price.lastPrice)
          : price.lastPrice;
      const newStop = newTrough * (1 + deltaFactor);

      (order as { trailPeakPrice: number }).trailPeakPrice = newTrough;
      (order as { trailStopPrice: number }).trailStopPrice = newStop;

      if (price.bestAsk >= newStop) {
        return this.buildTrailingFill(order, price, newStop, decisionId, requestId);
      }
    }

    return null;
  }

  private buildTrailingFill(
    order: PaperOpenOrder,
    price: CurrentPrice,
    triggerPrice: number,
    decisionId: string,
    requestId: string,
  ): FillResult {
    const fillPrice = this.applySlippage(triggerPrice, order.side);
    const qty = order.remainingQuantity;
    const notional = qty * fillPrice;
    const comm = this.commission(notional, false);

    const fill: PaperFillRecord = {
      fillId: randomUUID(),
      orderId: order.orderId,
      requestId,
      decisionId,
      strategyId: order.strategyId,
      symbol: order.symbol,
      side: order.side,
      orderType: order.type,
      isMaker: false,
      filledQuantity: qty,
      fillPrice,
      notional,
      commission: comm,
      slippage: this.slippageAmount(price, order.side, fillPrice, qty),
      realizedPnl: 0,
      filledAt: Date.now(),
    };

    const updatedOrder: PaperOpenOrder = {
      ...order,
      filledQuantity: order.filledQuantity + qty,
      remainingQuantity: 0,
      state: PaperOrderState.FILLED,
      updatedAt: Date.now(),
    };

    return { fill, updatedOrder, fillPrice, isMaker: false, isPartial: false };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private partialFillQty(remaining: number, canPartial: boolean): number {
    if (!canPartial || !this.cfg.partialFillEnabled) return remaining;
    const minPct = this.cfg.partialFillMinFillPercent;
    if (minPct >= 1) return remaining;
    const fillPct = minPct + Math.random() * (1 - minPct);
    const qty = remaining * fillPct;
    // Never fill less than 1% of the requested qty to avoid dust
    return Math.max(qty, remaining * 0.01);
  }

  private slippageAmount(
    price: CurrentPrice,
    side: OrderSide,
    fillPrice: number,
    qty: number,
  ): number {
    const ref = side === OrderSide.BUY ? price.bestAsk : price.bestBid;
    return Math.abs(fillPrice - ref) * qty;
  }

  // ── Latency simulation ───────────────────────────────────────────────────────

  async simulateLatency(): Promise<void> {
    if (!this.cfg.simulateLatency || this.cfg.latencyMs <= 0) return;
    const jitter = Math.random() * this.cfg.latencyJitterMs;
    const delay = this.cfg.latencyMs + jitter;
    await new Promise<void>((res) => setTimeout(res, delay));
  }
}
