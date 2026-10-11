/**
 * TypeAdapters — bidirectional type conversions between platform internal types
 * and SDK public types.
 *
 * The platform and the SDK maintain independent type hierarchies to decouple them:
 *   - Platform types may change internally without breaking SDK consumers
 *   - SDK types are versioned and stable across SDK minor releases
 *
 * All functions here are pure and have no side effects. They perform field-by-field
 * mapping and do NOT silently drop fields — any platform type that gains new fields
 * should be reflected in the corresponding SDK type in the next SDK release.
 *
 * Naming convention:
 *   toSdk*   — platform type → SDK type (used when providing data to strategies)
 *   fromSdk* — SDK type → platform type (used when strategies return signals)
 */

import {
  SdkCandle,
  SdkTick,
  SdkTrade,
  SdkOrderBook,
  SdkOrderBookLevel,
  SdkIndicatorValue,
  SdkPortfolioSnapshot,
  SdkOpenPosition,
  SdkAssetBalance,
  SdkExecutionReport,
  SdkOrderStatus,
  SdkRiskState,
  SdkSignal,
  SdkSignalDirection,
  SdkIndicatorType,
} from '@trading-platform/strategy-sdk';

import { Candle } from '@modules/indicator/domain/models/candle.model';
import { Timeframe } from '@modules/indicator/domain/enums/timeframe.enum';
import { IndicatorValue } from '@modules/indicator/domain/models/indicator-value.model';
import { IndicatorType } from '@modules/indicator/domain/enums/indicator-type.enum';
import { MarketTick, Trade, OrderBook } from '@modules/exchange/models/market.models';
import { ExecutionReport } from '@modules/exchange/models/trading.models';
import { OrderStatus } from '@modules/exchange/enums/order.enums';
import { Position, AssetBalance } from '@modules/exchange/models/account.models';
import {
  PortfolioSnapshot,
  OpenPositionSnapshot,
} from '@modules/risk/domain/models/portfolio-state.model';
import { Signal } from '@modules/strategy/interfaces/signal.interface';
import { SignalDirection } from '@modules/strategy/domain/enums/signal-direction.enum';
import { PositionSide } from '@modules/exchange/enums/position.enums';

// ── Candle ────────────────────────────────────────────────────────────────────

export function toSdkCandle(candle: Candle): SdkCandle {
  return {
    symbol: candle.symbol,
    exchange: candle.exchange,
    timeframe: candle.timeframe as SdkCandle['timeframe'],
    openTime: candle.openTime,
    closeTime: candle.closeTime,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    isClosed: candle.isClosed,
  };
}

export function fromSdkCandle(candle: SdkCandle): Candle {
  return {
    symbol: candle.symbol,
    exchange: candle.exchange,
    timeframe: candle.timeframe as Timeframe,
    openTime: candle.openTime,
    closeTime: candle.closeTime,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    isClosed: candle.isClosed,
  };
}

// ── MarketTick ────────────────────────────────────────────────────────────────

export function toSdkTick(tick: MarketTick): SdkTick {
  return {
    symbol: tick.symbol,
    exchange: String(tick.exchangeId),
    timestamp: tick.timestamp instanceof Date ? tick.timestamp.getTime() : Date.now(),
    bestBid: tick.bestBid,
    bestAsk: tick.bestAsk,
    bestBidQuantity: tick.bestBidQuantity,
    bestAskQuantity: tick.bestAskQuantity,
    spread: tick.spread,
    midPrice: tick.midPrice,
  };
}

// ── Trade ─────────────────────────────────────────────────────────────────────

export function toSdkTrade(trade: Trade): SdkTrade {
  return {
    symbol: trade.symbol,
    exchange: String(trade.exchangeId),
    timestamp: trade.timestamp instanceof Date ? trade.timestamp.getTime() : Date.now(),
    tradeId: trade.tradeId,
    price: trade.price,
    quantity: trade.quantity,
    quoteQuantity: trade.quoteQuantity,
    side: trade.side === 'BUY' ? 'BUY' : 'SELL',
    isBuyerMaker: trade.isBuyerMaker,
  };
}

// ── OrderBook ─────────────────────────────────────────────────────────────────

export function toSdkOrderBook(book: OrderBook): SdkOrderBook {
  const toLevel = (l: { price: number; quantity: number }): SdkOrderBookLevel => ({
    price: l.price,
    quantity: l.quantity,
  });
  return {
    symbol: book.symbol,
    exchange: String(book.exchangeId),
    timestamp: book.timestamp instanceof Date ? book.timestamp.getTime() : Date.now(),
    bids: book.bids.map(toLevel),
    asks: book.asks.map(toLevel),
    depth: book.depth,
  };
}

// ── IndicatorValue ────────────────────────────────────────────────────────────

/**
 * toSdkIndicatorValue converts the platform's IndicatorValue union to the SDK union.
 *
 * The mapping is 1-to-1 — every IndicatorType has a corresponding SdkIndicatorType.
 * Returns null for unrecognised types to be forward-compatible with platform indicator
 * additions before the SDK is updated to include them.
 */
export function toSdkIndicatorValue(value: IndicatorValue): SdkIndicatorValue | null {
  switch (value.type) {
    case IndicatorType.EMA:
      return { type: SdkIndicatorType.EMA, value: value.value };
    case IndicatorType.SMA:
      return { type: SdkIndicatorType.SMA, value: value.value };
    case IndicatorType.ATR:
      return { type: SdkIndicatorType.ATR, value: value.value };
    case IndicatorType.RSI:
      return { type: SdkIndicatorType.RSI, value: value.value };
    case IndicatorType.VWAP:
      return { type: SdkIndicatorType.VWAP, value: value.value };
    case IndicatorType.ADX:
      return { type: SdkIndicatorType.ADX, adx: value.adx, pdi: value.pdi, ndi: value.ndi };
    case IndicatorType.DONCHIAN:
      return {
        type: SdkIndicatorType.DONCHIAN,
        upper: value.upper,
        lower: value.lower,
        middle: value.middle,
      };
    case IndicatorType.BOLLINGER:
      return {
        type: SdkIndicatorType.BOLLINGER,
        upper: value.upper,
        middle: value.middle,
        lower: value.lower,
        bandwidth: value.bandwidth,
        percentB: value.percentB,
      };
    case IndicatorType.MACD:
      return {
        type: SdkIndicatorType.MACD,
        macd: value.macd,
        signal: value.signal,
        histogram: value.histogram,
      };
    case IndicatorType.SUPERTREND:
      return { type: SdkIndicatorType.SUPERTREND, value: value.value, direction: value.direction };
    case IndicatorType.VOLUME_MA:
      return { type: SdkIndicatorType.VOLUME_MA, value: value.value };
    case IndicatorType.VOLUME_SPIKE:
      return {
        type: SdkIndicatorType.VOLUME_SPIKE,
        ratio: value.ratio,
        avgVolume: value.avgVolume,
        currentVolume: value.currentVolume,
        isSpike: value.isSpike,
      };
    case IndicatorType.TRUE_RANGE:
      return { type: SdkIndicatorType.TRUE_RANGE, value: value.value };
    case IndicatorType.HIGHEST_HIGH:
      return { type: SdkIndicatorType.HIGHEST_HIGH, value: value.value };
    case IndicatorType.LOWEST_LOW:
      return { type: SdkIndicatorType.LOWEST_LOW, value: value.value };
    default:
      return null;
  }
}

// ── Portfolio ─────────────────────────────────────────────────────────────────

export function toSdkPortfolioSnapshot(snapshot: PortfolioSnapshot): SdkPortfolioSnapshot {
  return {
    equity: snapshot.equity,
    availableBalance: snapshot.availableBalance,
    totalExposure: snapshot.totalExposure,
    currentLeverage: snapshot.currentLeverage,
    openPositions: snapshot.openPositions.map(toSdkOpenPositionFromSnapshot),
    unrealizedPnl: snapshot.unrealizedPnl,
    snapshotAt: snapshot.snapshotAt,
  };
}

function toSdkOpenPositionFromSnapshot(pos: OpenPositionSnapshot): SdkOpenPosition {
  return {
    symbol: pos.symbol,
    side: (pos.side as string).toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG',
    quantity: pos.quantity,
    notionalValue: pos.notionalValue,
    unrealizedPnl: pos.unrealizedPnl,
    leverage: pos.leverage,
    entryPrice: 0, // PortfolioSnapshot does not carry entryPrice
    liquidationPrice: null, // Same — use Position directly when liquidationPrice is needed
  };
}

export function toSdkOpenPosition(pos: Position): SdkOpenPosition {
  return {
    symbol: pos.symbol,
    side: pos.positionSide === PositionSide.SHORT ? 'SHORT' : 'LONG',
    quantity: pos.quantity,
    notionalValue: pos.notionalValue,
    unrealizedPnl: pos.unrealizedPnl,
    leverage: pos.leverage,
    entryPrice: pos.entryPrice,
    liquidationPrice: pos.liquidationPrice ?? null,
  };
}

export function toSdkAssetBalance(balance: AssetBalance): SdkAssetBalance {
  return {
    asset: balance.asset,
    free: balance.free,
    locked: balance.locked,
    total: balance.total,
  };
}

// ── ExecutionReport ───────────────────────────────────────────────────────────

export function toSdkExecutionReport(
  report: ExecutionReport,
  strategyId: string,
): SdkExecutionReport {
  return {
    orderId: report.exchangeOrderId,
    clientOrderId: report.clientOrderId ?? '',
    symbol: report.symbol,
    exchange: String(report.exchangeId),
    status: toSdkOrderStatus(report.currentStatus),
    side: report.side === 'BUY' ? 'BUY' : 'SELL',
    executedQuantity: report.lastExecutedQuantity,
    executedPrice: report.lastExecutedPrice,
    cumulativeQuoteQuantity: report.cumulativeQuoteQuantity,
    commission: report.commissionAmount ?? 0,
    commissionAsset: report.commissionAsset ?? '',
    strategyId,
    timestamp: report.workingTime instanceof Date ? report.workingTime.getTime() : Date.now(),
    rejectReason: null, // ExecutionReport does not carry a reject reason field
  };
}

function toSdkOrderStatus(status: OrderStatus): SdkOrderStatus {
  switch (status) {
    case OrderStatus.NEW:
      return SdkOrderStatus.NEW;
    case OrderStatus.PARTIALLY_FILLED:
      return SdkOrderStatus.PARTIALLY_FILLED;
    case OrderStatus.FILLED:
      return SdkOrderStatus.FILLED;
    case OrderStatus.CANCELLED:
      return SdkOrderStatus.CANCELLED;
    case OrderStatus.REJECTED:
      return SdkOrderStatus.REJECTED;
    case OrderStatus.EXPIRED:
      return SdkOrderStatus.EXPIRED;
    default:
      return SdkOrderStatus.UNKNOWN;
  }
}

// ── RiskState ─────────────────────────────────────────────────────────────────

export function toSdkRiskState(
  drawdownPercent: number,
  dailyLossUsd: number,
  remainingDailyLossUsd: number,
  openPositionCount: number,
  signalsBlockedReason: string | null,
): SdkRiskState {
  return {
    drawdownPercent,
    dailyLossUsd,
    remainingDailyLossUsd,
    openPositionCount,
    signalsBlockedReason,
    snapshotAt: Date.now(),
  };
}

// ── Signal (SDK → Platform) ───────────────────────────────────────────────────

export function fromSdkSignal(sdkSignal: SdkSignal, strategyId: string, exchange: string): Signal {
  return {
    signalId: crypto.randomUUID(),
    timestamp: Date.now(),
    strategyId,
    exchange,
    symbol: sdkSignal.symbol,
    direction: fromSdkDirection(sdkSignal.direction),
    confidence: sdkSignal.confidence,
    reason: sdkSignal.reason,
    metadata: sdkSignal.metadata,
  };
}

function fromSdkDirection(dir: SdkSignalDirection): SignalDirection {
  switch (dir) {
    case SdkSignalDirection.BUY:
      return SignalDirection.BUY;
    case SdkSignalDirection.SELL:
      return SignalDirection.SELL;
    case SdkSignalDirection.EXIT:
      return SignalDirection.EXIT;
    case SdkSignalDirection.HOLD:
      return SignalDirection.HOLD;
    case SdkSignalDirection.REDUCE:
      return SignalDirection.REDUCE;
    case SdkSignalDirection.REVERSE:
      return SignalDirection.REVERSE;
    default: {
      // Exhaustiveness guard — protects against future SDK enum additions
      const _exhaustive: never = dir;
      throw new Error(`Unknown SdkSignalDirection: ${String(_exhaustive)}`);
    }
  }
}
