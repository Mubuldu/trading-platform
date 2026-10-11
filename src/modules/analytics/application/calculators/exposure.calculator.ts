import { Injectable } from '@nestjs/common';
import { AnalyticsPositionSnapshot } from '../../domain/models/analytics-trade.model';
import { ExposureMetrics } from '../../domain/models/exposure-metrics.model';

/**
 * ExposureCalculator computes portfolio exposure metrics from open positions.
 *
 * All monetary values are in quote currency (USDT).
 * Percentage values are fractional relative to totalEquity.
 *
 * grossExposure = sum of all |notional| values
 * netExposure   = sum of signed notionals (LONG positive, SHORT negative)
 * longExposure  = sum of LONG notionals
 * shortExposure = sum of SHORT notionals (unsigned)
 */
@Injectable()
export class ExposureCalculator {
  compute(positions: AnalyticsPositionSnapshot[], totalEquity: number): ExposureMetrics {
    const openPositions = positions.filter((p) => p.direction !== ('FLAT' as unknown));

    let longExposure = 0;
    let shortExposure = 0;
    let longCount = 0;
    let shortCount = 0;

    const bySymbol: ExposureMetrics['bySymbol'] = {};
    const byStrategy: ExposureMetrics['byStrategy'] = {};
    const byExchange: ExposureMetrics['byExchange'] = {};

    for (const pos of openPositions) {
      const pctOfEquity = totalEquity > 0 ? pos.notional / totalEquity : 0;

      if (pos.direction === 'LONG') {
        longExposure += pos.notional;
        longCount++;
      } else {
        shortExposure += pos.notional;
        shortCount++;
      }

      // By symbol
      if (!bySymbol[pos.symbol]) {
        bySymbol[pos.symbol] = {
          direction: pos.direction,
          quantity: pos.quantity,
          notional: pos.notional,
          unrealizedPnl: pos.unrealizedPnl,
          percentOfEquity: pctOfEquity,
        };
      } else {
        const existing = bySymbol[pos.symbol]!;
        bySymbol[pos.symbol] = {
          ...existing,
          quantity: existing.quantity + pos.quantity,
          notional: existing.notional + pos.notional,
          unrealizedPnl: existing.unrealizedPnl + pos.unrealizedPnl,
          percentOfEquity: existing.percentOfEquity + pctOfEquity,
        };
      }

      // By strategy
      if (!byStrategy[pos.strategyId]) {
        byStrategy[pos.strategyId] = {
          notional: pos.notional,
          percentOfEquity: pctOfEquity,
          positionCount: 1,
        };
      } else {
        const existing = byStrategy[pos.strategyId]!;
        byStrategy[pos.strategyId] = {
          notional: existing.notional + pos.notional,
          percentOfEquity: existing.percentOfEquity + pctOfEquity,
          positionCount: existing.positionCount + 1,
        };
      }

      // By exchange
      if (!byExchange[pos.exchangeId]) {
        byExchange[pos.exchangeId] = {
          notional: pos.notional,
          percentOfEquity: pctOfEquity,
          positionCount: 1,
        };
      } else {
        const existing = byExchange[pos.exchangeId]!;
        byExchange[pos.exchangeId] = {
          notional: existing.notional + pos.notional,
          percentOfEquity: existing.percentOfEquity + pctOfEquity,
          positionCount: existing.positionCount + 1,
        };
      }
    }

    return {
      grossExposure: longExposure + shortExposure,
      netExposure: longExposure - shortExposure,
      longExposure,
      shortExposure,
      bySymbol,
      byStrategy,
      byExchange,
      longPositionCount: longCount,
      shortPositionCount: shortCount,
      totalPositionCount: openPositions.length,
      snapshotAt: Date.now(),
    };
  }
}
