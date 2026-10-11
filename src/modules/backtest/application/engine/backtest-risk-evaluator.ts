import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Signal } from '@modules/strategy/interfaces/signal.interface';
import { SignalDirection } from '@modules/strategy/domain/enums/signal-direction.enum';
import { OrderSide, OrderType } from '@modules/exchange/enums/order.enums';
import { BacktestPortfolioState } from '../portfolio/backtest-portfolio-tracker.service';

export interface BacktestRiskDecision {
  readonly decisionId: string;
  readonly signal: Signal;
  readonly approved: boolean;
  readonly reason: string;
  readonly sizeUsd: number;
  readonly side: OrderSide;
  readonly orderType: OrderType;
  readonly price?: number;
  readonly stopPrice?: number;
  readonly trailingDeltaPercent?: number;
}

export interface BacktestRiskConfig {
  readonly initialCapitalUsd: number;
  readonly maxPositionSizePercent: number;
  readonly maxDailyLossPercent: number;
  readonly enableRiskChecks: boolean;
}

@Injectable()
export class BacktestRiskEvaluator {
  evaluate(
    signal: Signal,
    portfolio: BacktestPortfolioState,
    riskConfig: BacktestRiskConfig,
  ): BacktestRiskDecision {
    const decisionId = randomUUID();

    if (signal.direction === SignalDirection.HOLD) {
      return {
        decisionId,
        signal,
        approved: false,
        reason: 'HOLD signal — no action required',
        sizeUsd: 0,
        side: OrderSide.BUY,
        orderType: OrderType.MARKET,
      };
    }

    if (riskConfig.enableRiskChecks) {
      const dailyLossCheck = this.checkDailyLoss(portfolio, riskConfig);
      if (!dailyLossCheck.passed) {
        return {
          decisionId,
          signal,
          approved: false,
          reason: dailyLossCheck.reason,
          sizeUsd: 0,
          side: OrderSide.BUY,
          orderType: OrderType.MARKET,
        };
      }
    }

    const side = this.resolveSide(signal.direction);

    // EXIT / SELL / REDUCE signals close existing positions — they do not require
    // additional cash, so we skip the size and cash checks entirely and approve
    // immediately. Use initialCapitalUsd (always positive) as the sizeUsd so that
    // even when equity has gone negative the resulting quantity is positive and
    // the execution simulator can fill the closing order.
    if (side === OrderSide.SELL) {
      // Also: ensure there IS an open position to exit before approving.
      const hasPosition = [...portfolio.openPositions.values()].some(
        (p) => p.symbol === signal.symbol,
      );
      if (!hasPosition) {
        return {
          decisionId,
          signal,
          approved: false,
          reason: `No open position for ${signal.symbol} — exit signal ignored`,
          sizeUsd: 0,
          side: OrderSide.SELL,
          orderType: OrderType.MARKET,
        };
      }
      return {
        decisionId,
        signal,
        approved: true,
        reason: 'Exit/reduce signal — position close approved without cash check',
        sizeUsd: riskConfig.initialCapitalUsd,
        side,
        orderType: this.resolveOrderType(signal),
        price: this.resolvePrice(signal),
        stopPrice: this.resolveStopPrice(signal),
        trailingDeltaPercent: this.resolveTrailingDelta(signal),
      };
    }

    // BUY: reject if already in a position for this symbol (no stacking).
    const alreadyLong = [...portfolio.openPositions.values()].some(
      (p) => p.symbol === signal.symbol,
    );
    if (alreadyLong) {
      return {
        decisionId,
        signal,
        approved: false,
        reason: `Already holding a position for ${signal.symbol} — new entry rejected`,
        sizeUsd: 0,
        side: OrderSide.BUY,
        orderType: OrderType.MARKET,
      };
    }

    const sizeUsd = this.calculatePositionSize(portfolio.equity, riskConfig.maxPositionSizePercent);

    if (sizeUsd <= 0) {
      return {
        decisionId,
        signal,
        approved: false,
        reason: `Calculated position size $${sizeUsd.toFixed(2)} is zero or negative`,
        sizeUsd: 0,
        side: OrderSide.BUY,
        orderType: OrderType.MARKET,
      };
    }

    if (sizeUsd > portfolio.cash * 1.05) {
      return {
        decisionId,
        signal,
        approved: false,
        reason: `Insufficient cash: need $${sizeUsd.toFixed(2)}, available $${portfolio.cash.toFixed(2)}`,
        sizeUsd: 0,
        side: OrderSide.BUY,
        orderType: OrderType.MARKET,
      };
    }

    const orderType = this.resolveOrderType(signal);
    const price = this.resolvePrice(signal);
    const stopPrice = this.resolveStopPrice(signal);
    const trailingDelta = this.resolveTrailingDelta(signal);

    return {
      decisionId,
      signal,
      approved: true,
      reason: 'All checks passed',
      sizeUsd,
      side,
      orderType,
      price,
      stopPrice,
      trailingDeltaPercent: trailingDelta,
    };
  }

  private checkDailyLoss(
    portfolio: BacktestPortfolioState,
    config: BacktestRiskConfig,
  ): { passed: boolean; reason: string } {
    const maxDailyLossUsd = config.initialCapitalUsd * (config.maxDailyLossPercent / 100);
    if (portfolio.dailyRealizedPnl < -maxDailyLossUsd) {
      return {
        passed: false,
        reason: `Daily loss limit hit: realized PnL $${portfolio.dailyRealizedPnl.toFixed(2)} exceeds limit -$${maxDailyLossUsd.toFixed(2)}`,
      };
    }
    return { passed: true, reason: '' };
  }

  private calculatePositionSize(equity: number, maxPositionSizePercent: number): number {
    return equity * (maxPositionSizePercent / 100);
  }

  private resolveSide(direction: SignalDirection): OrderSide {
    switch (direction) {
      case SignalDirection.BUY:
        return OrderSide.BUY;
      case SignalDirection.SELL:
      case SignalDirection.EXIT:
      case SignalDirection.REDUCE:
        return OrderSide.SELL;
      case SignalDirection.REVERSE:
        return OrderSide.SELL;
      default:
        return OrderSide.BUY;
    }
  }

  private resolveOrderType(signal: Signal): OrderType {
    const typeStr = signal.metadata['orderType'];
    if (typeof typeStr === 'string') {
      const upper = typeStr.toUpperCase();
      if (Object.values(OrderType).includes(upper as OrderType)) {
        return upper as OrderType;
      }
    }
    const hasPrice =
      typeof signal.metadata['price'] === 'number' && (signal.metadata['price'] as number) > 0;
    const hasStop =
      typeof signal.metadata['stopPrice'] === 'number' &&
      (signal.metadata['stopPrice'] as number) > 0;
    const hasTrailing = typeof signal.metadata['trailingDeltaPercent'] === 'number';

    if (hasTrailing) return OrderType.TRAILING_STOP;
    if (hasStop && hasPrice) return OrderType.STOP_LIMIT;
    if (hasStop) return OrderType.STOP;
    if (hasPrice) return OrderType.LIMIT;
    return OrderType.MARKET;
  }

  private resolvePrice(signal: Signal): number | undefined {
    const price = signal.metadata['price'];
    return typeof price === 'number' && price > 0 ? price : undefined;
  }

  private resolveStopPrice(signal: Signal): number | undefined {
    const stop = signal.metadata['stopPrice'];
    return typeof stop === 'number' && stop > 0 ? stop : undefined;
  }

  private resolveTrailingDelta(signal: Signal): number | undefined {
    const delta = signal.metadata['trailingDeltaPercent'];
    return typeof delta === 'number' && delta > 0 ? delta : undefined;
  }
}
